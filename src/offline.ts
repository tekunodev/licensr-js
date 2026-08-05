import {createRemoteJWKSet, customFetch, jwtVerify} from 'jose';
import {LicensrTokenVerificationError} from './errors.js';
import type {OfflineTokenClaims} from './types.js';

export interface VerifyOfflineTokenOptions {
  /** Override the fetch used for the JWKS lookup — mainly for testing. */
  fetchImpl?: typeof fetch;
  /** Reject if the token's `iat`/`nbf` are further in the future than this many seconds (clock skew tolerance). Default 60. */
  clockToleranceSeconds?: number;
}

// `createRemoteJWKSet` already caches keys in-memory with a cooldown, so
// reusing one instance per JWKS URL for the process lifetime avoids an
// extra fetch on every verification while still picking up key rotation.
const jwksSetCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(jwksUrl: string, fetchImpl?: typeof fetch): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksSetCache.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(jwksUrl),
      fetchImpl ? {[customFetch]: (url, options) => fetchImpl(url, options as RequestInit)} : undefined
    );
    jwksSetCache.set(jwksUrl, jwks);
  }
  return jwks;
}

/** Drop cached JWKS lookups — call after rotating a plugin's signing key in tests, or to force a fresh fetch. */
export function clearJwksCache(): void {
  jwksSetCache.clear();
}

/**
 * Verify an offline license token (from {@link import('./client.js').LicensrClient.token})
 * fully offline: no network call beyond fetching (and caching) the plugin's
 * public JWKS. Throws {@link LicensrTokenVerificationError} on a bad
 * signature, wrong algorithm, or an expired/not-yet-valid token.
 *
 * Tokens carry no revocation signal — this only proves the token was
 * genuinely issued by Licensr and hasn't expired, not that the license is
 * still active right now. Re-validate online (`validate()`/`token()`)
 * before the token's `expiresAt`.
 */
export async function verifyOfflineToken(
  token: string,
  jwksUrl: string,
  options: VerifyOfflineTokenOptions = {}
): Promise<OfflineTokenClaims> {
  const jwks = getJwks(jwksUrl, options.fetchImpl);
  try {
    const {payload} = await jwtVerify(token, jwks, {
      algorithms: ['EdDSA'],
      clockTolerance: options.clockToleranceSeconds ?? 60,
    });
    return payload as unknown as OfflineTokenClaims;
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new LicensrTokenVerificationError(`Offline token verification failed: ${reason}`);
  }
}

export interface CachedOfflineToken {
  token: string;
  claims: OfflineTokenClaims;
  /** `Date.now()` at the time this entry was cached. */
  cachedAtMs: number;
}

/**
 * Pluggable persistence for the last-known-good offline token per license,
 * so an app can boot fully offline (no network at all) before its first
 * successful `/token` call in a given session. The default
 * {@link InMemoryOfflineTokenStore} does not persist across process
 * restarts — provide your own (backed by `localStorage`, a config file,
 * OS keychain, etc.) for that.
 */
export interface OfflineTokenStore {
  get(licenseKey: string): CachedOfflineToken | null | Promise<CachedOfflineToken | null>;
  set(licenseKey: string, entry: CachedOfflineToken): void | Promise<void>;
  clear(licenseKey: string): void | Promise<void>;
}

export class InMemoryOfflineTokenStore implements OfflineTokenStore {
  private readonly entries = new Map<string, CachedOfflineToken>();

  get(licenseKey: string): CachedOfflineToken | null {
    return this.entries.get(licenseKey) ?? null;
  }

  set(licenseKey: string, entry: CachedOfflineToken): void {
    this.entries.set(licenseKey, entry);
  }

  clear(licenseKey: string): void {
    this.entries.delete(licenseKey);
  }
}
