import {exportJWK, generateKeyPair, SignJWT} from 'jose';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {LicensrTokenVerificationError} from '../src/errors.js';
import {clearJwksCache, InMemoryOfflineTokenStore, verifyOfflineToken} from '../src/offline.js';

const JWKS_URL = 'https://api.licensr.test/v1/license/jwks/acme/demo.json';

async function signToken(
  claims: Record<string, unknown>,
  overrides: {alg?: string} = {}
): Promise<{token: string; jwks: object}> {
  const {publicKey, privateKey} = await generateKeyPair('EdDSA', {crv: 'Ed25519'});
  const jwk = await exportJWK(publicKey);
  const kid = 'test-kid-1';

  const token = await new SignJWT(claims).setProtectedHeader({alg: overrides.alg ?? 'EdDSA', kid}).sign(privateKey);

  return {token, jwks: {keys: [{...jwk, kid, use: 'sig', alg: 'EdDSA'}]}};
}

function fetchImplFor(jwks: object): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(jwks), {status: 200, headers: {'Content-Type': 'application/json'}})) as typeof fetch;
}

describe('verifyOfflineToken', () => {
  beforeEach(() => {
    clearJwksCache();
  });

  afterEach(() => {
    clearJwksCache();
  });

  it('verifies a genuinely EdDSA-signed token and returns its claims', async () => {
    const now = Math.floor(Date.now() / 1000);
    const {token, jwks} = await signToken({
      sub: 'license-123',
      plugin_slug: 'demo',
      status: 'active',
      valid: true,
      entitlement: 'full',
      fallback: false,
      iat: now,
      nbf: now,
      exp: now + 3600,
    });

    const claims = await verifyOfflineToken(token, JWKS_URL, {fetchImpl: fetchImplFor(jwks)});

    expect(claims.sub).toBe('license-123');
    expect(claims.valid).toBe(true);
    expect(claims.entitlement).toBe('full');
  });

  it('rejects a token signed by a key not in the JWKS', async () => {
    const now = Math.floor(Date.now() / 1000);
    const {token} = await signToken({sub: 'license-123', iat: now, nbf: now, exp: now + 3600});
    const {jwks: otherJwks} = await signToken({sub: 'unrelated', iat: now, nbf: now, exp: now + 3600});

    await expect(verifyOfflineToken(token, JWKS_URL, {fetchImpl: fetchImplFor(otherJwks)})).rejects.toBeInstanceOf(
      LicensrTokenVerificationError
    );
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const {token, jwks} = await signToken({sub: 'license-123', iat: now - 7200, nbf: now - 7200, exp: now - 3600});

    await expect(verifyOfflineToken(token, JWKS_URL, {fetchImpl: fetchImplFor(jwks)})).rejects.toBeInstanceOf(
      LicensrTokenVerificationError
    );
  });

  it('rejects a token whose kid matches a JWKS entry but whose signature does not verify against it', async () => {
    const {privateKey} = await generateKeyPair('EdDSA', {crv: 'Ed25519'});
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({sub: 'license-123', iat: now, nbf: now, exp: now + 3600})
      .setProtectedHeader({alg: 'EdDSA', kid: 'kid-1'})
      .sign(privateKey);
    // Same kid, but an unrelated public key -- simulates key confusion /
    // a corrupted JWKS rather than a straightforwardly-missing key.
    const {publicKey: unrelatedPublicKey} = await generateKeyPair('EdDSA', {crv: 'Ed25519'});
    const jwk = await exportJWK(unrelatedPublicKey);

    await expect(
      verifyOfflineToken(token, JWKS_URL, {
        fetchImpl: fetchImplFor({keys: [{...jwk, kid: 'kid-1', use: 'sig', alg: 'EdDSA'}]}),
      })
    ).rejects.toBeInstanceOf(LicensrTokenVerificationError);
  });

  it('reuses the cached JWKS resolver across repeated verifications of the same URL', async () => {
    const now = Math.floor(Date.now() / 1000);
    const {token, jwks} = await signToken({sub: 'license-123', iat: now, nbf: now, exp: now + 3600});
    const fetchImpl = vi.fn(fetchImplFor(jwks));

    await verifyOfflineToken(token, JWKS_URL, {fetchImpl});
    await verifyOfflineToken(token, JWKS_URL, {fetchImpl});

    // The second call reuses the cached `createRemoteJWKSet` resolver
    // instead of hitting the network again (jose's own cooldown window).
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to the ambient fetch when no fetchImpl override is given', async () => {
    const now = Math.floor(Date.now() / 1000);
    const {token, jwks} = await signToken({sub: 'license-123', iat: now, nbf: now, exp: now + 3600});
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(fetchImplFor(jwks));
    try {
      const claims = await verifyOfflineToken(token, JWKS_URL);
      expect(claims.sub).toBe('license-123');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects a malformed token string', async () => {
    await expect(
      verifyOfflineToken('not-a-jwt', JWKS_URL, {fetchImpl: fetchImplFor({keys: []})})
    ).rejects.toBeInstanceOf(LicensrTokenVerificationError);
  });
});

describe('InMemoryOfflineTokenStore', () => {
  it('round-trips get/set/clear for a license key', () => {
    const store = new InMemoryOfflineTokenStore();
    expect(store.get('lic_abc')).toBeNull();

    const entry = {
      token: 'jwt.token.value',
      claims: {} as never,
      cachedAtMs: Date.now(),
    };
    store.set('lic_abc', entry);
    expect(store.get('lic_abc')).toBe(entry);

    store.clear('lic_abc');
    expect(store.get('lic_abc')).toBeNull();
  });

  it('keeps entries for different license keys independent', () => {
    const store = new InMemoryOfflineTokenStore();
    store.set('lic_a', {token: 'a', claims: {} as never, cachedAtMs: 1});
    store.set('lic_b', {token: 'b', claims: {} as never, cachedAtMs: 2});

    expect(store.get('lic_a')?.token).toBe('a');
    expect(store.get('lic_b')?.token).toBe('b');
  });
});
