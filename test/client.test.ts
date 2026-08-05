import {beforeEach, describe, expect, it, vi} from 'vitest';
import {LicensrClient} from '../src/client.js';
import {LicensrApiError} from '../src/errors.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

function makeClient(fetchImpl: ReturnType<typeof vi.fn>): LicensrClient {
  return new LicensrClient({
    apiKey: 'pk_live_test',
    pluginSlug: 'demo-plugin',
    baseUrl: 'https://api.example.test',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    retry: {maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1},
  });
}

function lastRequest(fetchImpl: ReturnType<typeof vi.fn>): {url: string; body: unknown; method: string} {
  const calls = fetchImpl.mock.calls;
  const [url, init] = calls[calls.length - 1] as [string, RequestInit];
  return {url, method: init.method as string, body: init.body ? JSON.parse(init.body as string) : undefined};
}

describe('LicensrClient', () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn();
  });

  it('validate() posts snake_case fields with the constructor pluginSlug and maps the camelCase response', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(200, {
        valid: true,
        status: 'active',
        plan_id: 'plan-1',
        plan_name: 'Pro',
        activation_mode: 'seat',
        max_seats: 5,
        max_domains: null,
        seats_in_use: 1,
        expires_at: null,
        entitlement: 'full',
        fallback: false,
        feature_flags: null,
      })
    );
    const client = makeClient(fetchImpl);

    const result = await client.validate({licenseKey: 'lic_abc'});

    expect(result.valid).toBe(true);
    expect(result.planName).toBe('Pro');
    const {url, method, body} = lastRequest(fetchImpl);
    expect(method).toBe('POST');
    expect(url).toBe('https://api.example.test/v1/license/validate');
    expect(body).toEqual({license_key: 'lic_abc', plugin_slug: 'demo-plugin'});
  });

  it('token() maps the offline-token response to camelCase', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(200, {
        token: 'jwt-value',
        algorithm: 'EdDSA',
        kid: 'kid-1',
        issued_at: '2027-01-01T00:00:00Z',
        expires_at: '2027-02-01T00:00:00Z',
        jwks_url: 'https://api.example.test/v1/license/jwks/acme/demo-plugin.json',
      })
    );
    const client = makeClient(fetchImpl);

    const result = await client.token({licenseKey: 'lic_abc'});

    expect(result.token).toBe('jwt-value');
    expect(result.jwksUrl).toBe('https://api.example.test/v1/license/jwks/acme/demo-plugin.json');
    expect(lastRequest(fetchImpl).url).toBe('https://api.example.test/v1/license/token');
  });

  it('activate() sends activation_type/identifier/label and maps the response', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(200, {activation_id: 'act-1', activation_type: 'seat', identifier: 'hwid-1', feature_flags: null})
    );
    const client = makeClient(fetchImpl);

    const result = await client.activate({
      licenseKey: 'lic_abc',
      activationType: 'seat',
      identifier: 'hwid-1',
      label: 'My Mac',
    });

    expect(result.activationId).toBe('act-1');
    const {body} = lastRequest(fetchImpl);
    expect(body).toEqual({
      license_key: 'lic_abc',
      plugin_slug: 'demo-plugin',
      activation_type: 'seat',
      identifier: 'hwid-1',
      label: 'My Mac',
    });
  });

  it('activate() defaults an omitted label to null rather than undefined', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(200, {
        activation_id: 'act-1',
        activation_type: 'domain',
        identifier: 'example.com',
        feature_flags: null,
      })
    );
    const client = makeClient(fetchImpl);

    await client.activate({licenseKey: 'lic_abc', activationType: 'domain', identifier: 'example.com'});

    expect(lastRequest(fetchImpl).body).toMatchObject({label: null});
  });

  it('deactivate() does not send a plugin_slug (deactivate is scoped by activation_id alone)', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(200, {deactivated: true}));
    const client = makeClient(fetchImpl);

    const result = await client.deactivate({licenseKey: 'lic_abc', activationId: 'act-1'});

    expect(result.deactivated).toBe(true);
    expect(lastRequest(fetchImpl).body).toEqual({license_key: 'lic_abc', activation_id: 'act-1'});
  });

  it('activations() sends a GET with license_key/plugin_slug as query params', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(200, {license_id: 'lic-1', activations: []}));
    const client = makeClient(fetchImpl);

    const result = await client.activations({licenseKey: 'lic_abc'});

    expect(result.licenseId).toBe('lic-1');
    const {url, method} = lastRequest(fetchImpl);
    expect(method).toBe('GET');
    expect(url).toBe('https://api.example.test/v1/license/activations?license_key=lic_abc&plugin_slug=demo-plugin');
  });

  it('checkout() posts plan_id/customer_email and maps checkout_url', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(200, {checkout_url: 'https://checkout.stripe.com/session/1'}));
    const client = makeClient(fetchImpl);

    const result = await client.checkout({planId: 'plan-1', customerEmail: 'buyer@example.com'});

    expect(result.checkoutUrl).toBe('https://checkout.stripe.com/session/1');
    const {url, body} = lastRequest(fetchImpl);
    expect(url).toBe('https://api.example.test/v1/billing/checkout');
    expect(body).toEqual({plan_id: 'plan-1', customer_email: 'buyer@example.com', success_url: null, cancel_url: null});
  });

  it('emits a typed lifecycle event on success', async () => {
    fetchImpl.mockResolvedValue(
      jsonResponse(200, {
        valid: true,
        status: 'active',
        plan_id: null,
        plan_name: null,
        activation_mode: null,
        max_seats: null,
        max_domains: null,
        seats_in_use: null,
        expires_at: null,
        entitlement: 'full',
        fallback: false,
        feature_flags: null,
      })
    );
    const client = makeClient(fetchImpl);
    const onValidated = vi.fn();
    client.events.on('validated', onValidated);

    await client.validate({licenseKey: 'lic_abc'});

    expect(onValidated).toHaveBeenCalledTimes(1);
    expect(onValidated).toHaveBeenCalledWith(expect.objectContaining({valid: true}));
  });

  it('emits an error event and rethrows when the API responds with an error', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(403, {detail: {error: 'license_inactive', message: 'inactive'}}));
    const client = makeClient(fetchImpl);
    const onError = vi.fn();
    client.events.on('error', onError);

    await expect(client.validate({licenseKey: 'lic_abc'})).rejects.toBeInstanceOf(LicensrApiError);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({method: 'validate'}));
  });

  it('defaults baseUrl to https://api.licensr.app when not overridden', async () => {
    fetchImpl.mockResolvedValue(jsonResponse(200, {deactivated: true}));
    const client = new LicensrClient({
      apiKey: 'pk_live_test',
      pluginSlug: 'demo-plugin',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.deactivate({licenseKey: 'lic_abc', activationId: 'act-1'});

    expect(lastRequest(fetchImpl).url).toBe('https://api.licensr.app/v1/license/deactivate');
  });
});
