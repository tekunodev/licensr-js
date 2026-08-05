import {describe, expect, it, vi} from 'vitest';
import {LicensrApiError, LicensrNetworkError} from '../src/errors.js';
import {DEVICE_ID_HEADER, requestJson, type HttpClientConfig} from '../src/http.js';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', ...headers}});
}

function baseConfig(overrides: Partial<HttpClientConfig> = {}): HttpClientConfig {
  return {
    baseUrl: 'https://api.example.test',
    apiKey: 'pk_live_test',
    retry: {maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2},
    ...overrides,
  };
}

describe('requestJson', () => {
  it('sends the Authorization header and JSON body, and returns the parsed response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {valid: true}));

    const result = await requestJson(baseConfig({fetchImpl}), {
      method: 'POST',
      path: 'v1/license/validate',
      body: {license_key: 'lic_x', plugin_slug: 'demo'},
    });

    expect(result).toEqual({valid: true});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/v1/license/validate');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({license_key: 'lic_x', plugin_slug: 'demo'}));
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer pk_live_test');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('appends query parameters for GET requests and sends no body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {activations: []}));

    await requestJson(baseConfig({fetchImpl}), {
      method: 'GET',
      path: 'v1/license/activations',
      query: {license_key: 'lic_x', plugin_slug: 'demo'},
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.test/v1/license/activations?license_key=lic_x&plugin_slug=demo');
    expect(init.body).toBeUndefined();
  });

  it('sends the device id header when configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));

    await requestJson(baseConfig({fetchImpl, deviceId: 'device-123'}), {
      method: 'POST',
      path: 'v1/license/token',
      body: {},
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get(DEVICE_ID_HEADER)).toBe('device-123');
  });

  it('returns undefined for a 204 No Content response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, {status: 204}));

    const result = await requestJson(baseConfig({fetchImpl}), {
      method: 'POST',
      path: 'v1/license/deactivate',
      body: {},
    });

    expect(result).toBeUndefined();
  });

  it('throws LicensrApiError with the parsed detail.error code on a hand-written HTTPException shape', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, {detail: {error: 'origin_not_allowed', message: 'nope'}}));

    const promise = requestJson(baseConfig({fetchImpl}), {method: 'POST', path: 'v1/license/validate', body: {}});
    await expect(promise).rejects.toBeInstanceOf(LicensrApiError);
    await expect(promise).rejects.toMatchObject({
      name: 'LicensrApiError',
      status: 403,
      code: 'origin_not_allowed',
      message: 'nope',
    });
  });

  it('throws LicensrApiError with code validation_error on a FastAPI/Pydantic 422 body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(422, {detail: [{msg: 'field required', loc: ['body', 'license_key']}]}));

    await expect(
      requestJson(baseConfig({fetchImpl}), {method: 'POST', path: 'v1/license/validate', body: {}})
    ).rejects.toMatchObject({code: 'validation_error', message: 'field required'});
  });

  it('retries a 500 response and succeeds once the server recovers', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, {detail: {error: 'internal', message: 'oops'}}))
      .mockResolvedValueOnce(jsonResponse(200, {valid: true}));

    const result = await requestJson(baseConfig({fetchImpl}), {method: 'POST', path: 'v1/license/validate', body: {}});

    expect(result).toEqual({valid: true});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('honours Retry-After on a 429 before retrying', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {detail: {error: 'rate_limit_exceeded'}}, {'Retry-After': '2'}))
      .mockResolvedValueOnce(jsonResponse(200, {valid: true}));

    const promise = requestJson(baseConfig({fetchImpl}), {method: 'POST', path: 'v1/license/validate', body: {}});
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toEqual({valid: true});
    vi.useRealTimers();
  });

  it('gives up after exhausting retries on repeated 5xx responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, {detail: {error: 'unavailable', message: 'down'}}));

    await expect(
      requestJson(baseConfig({fetchImpl, retry: {maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1}}), {
        method: 'POST',
        path: 'v1/license/validate',
        body: {},
      })
    ).rejects.toMatchObject({code: 'unavailable'});
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retriable 4xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, {detail: {error: 'license_not_found'}}));

    await expect(
      requestJson(baseConfig({fetchImpl}), {method: 'POST', path: 'v1/license/deactivate', body: {}})
    ).rejects.toMatchObject({code: 'license_not_found'});
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('wraps a persistent network failure in LicensrNetworkError after retries', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      requestJson(baseConfig({fetchImpl, retry: {maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1}}), {
        method: 'POST',
        path: 'v1/license/validate',
        body: {},
      })
    ).rejects.toBeInstanceOf(LicensrNetworkError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('recovers from a transient network failure on retry', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(200, {valid: true}));

    const result = await requestJson(baseConfig({fetchImpl}), {method: 'POST', path: 'v1/license/validate', body: {}});
    expect(result).toEqual({valid: true});
  });

  it('calls onRetry with the attempt number and delay before each retry', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, {detail: {error: 'internal'}}))
      .mockResolvedValueOnce(jsonResponse(200, {valid: true}));
    const onRetry = vi.fn();

    await requestJson(baseConfig({fetchImpl}), {method: 'POST', path: 'v1/license/validate', body: {}, onRetry});

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Number));
  });

  it('falls back to a generic error when the JSON body has no recognizable detail shape', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}, {}));

    await expect(
      requestJson(baseConfig({fetchImpl, retry: {maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1}}), {
        method: 'POST',
        path: 'v1/license/validate',
        body: {},
      })
    ).rejects.toMatchObject({code: 'unknown_error'});
  });

  it('falls back to a generic error when the error body is not JSON', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('<html>bad gateway</html>', {status: 502, statusText: 'Bad Gateway'}));

    await expect(
      requestJson(baseConfig({fetchImpl, retry: {maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1}}), {
        method: 'POST',
        path: 'v1/license/validate',
        body: {},
      })
    ).rejects.toMatchObject({code: 'unknown_error', message: 'Bad Gateway'});
  });

  it('sets the Origin header when explicitly configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));

    await requestJson(baseConfig({fetchImpl, origin: 'app://my-plugin'}), {
      method: 'POST',
      path: 'v1/license/validate',
      body: {},
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('Origin')).toBe('app://my-plugin');
  });

  it('throws LicensrNetworkError when no fetch implementation is available', async () => {
    const originalFetch = globalThis.fetch;
    // @ts-expect-error -- simulating Node < 18 with no global fetch.
    delete globalThis.fetch;
    try {
      await expect(
        requestJson(baseConfig({fetchImpl: undefined}), {method: 'POST', path: 'v1/license/validate', body: {}})
      ).rejects.toBeInstanceOf(LicensrNetworkError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
