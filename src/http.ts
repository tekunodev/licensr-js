import {LicensrApiError, LicensrNetworkError} from './errors.js';

/** SDKs already compute a stable per-machine HWID for activation — send it
 * here for free so the server buckets rate limits per *installation*
 * rather than per API key (see backend/services/rate_limit_key.py). */
export const DEVICE_ID_HEADER = 'X-Licensr-Device-Id';

export interface RetryOptions {
  /** Extra attempts after the first, on network errors / 429 / 5xx. Default 2. */
  maxRetries?: number;
  /** Base delay for exponential backoff with full jitter. Default 300ms. */
  baseDelayMs?: number;
  /** Ceiling for the backoff delay. Default 5000ms. */
  maxDelayMs?: number;
}

export interface HttpClientConfig {
  baseUrl: string;
  apiKey: string;
  /**
   * Explicitly set the `Origin` header. Real browsers control this header
   * themselves — the fetch spec forbids scripts from overriding it, and
   * that's fine, since the browser already sends the caller's true origin.
   * This option exists for non-browser runtimes (Node, Electron main
   * process) that want the domain-origin guard (see docs/sdks) to see a
   * specific origin. Native/desktop plugins should instead set the
   * plugin's client type to "native" in the admin UI and leave this unset.
   */
  origin?: string;
  /** Stable per-install identifier — see {@link DEVICE_ID_HEADER}. */
  deviceId?: string;
  /** Defaults to `globalThis.fetch`. Override for testing or non-standard runtimes. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. Unset by default (no timeout). */
  timeoutMs?: number;
  retry?: RetryOptions;
}

interface RequestSpec {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  /** Called right before each retry's backoff delay — wired to the `retry` event in {@link import('./client.js').LicensrClient}. */
  onRetry?: (attempt: number, delayMs: number) => void;
}

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxRetries: 2,
  baseDelayMs: 300,
  maxDelayMs: 5000,
};

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with full jitter (AWS-style): `random(0, min(max, base * 2^attempt))`. */
function jitterDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.random() * cap;
}

function isLikelyBrowserCorsFailure(cause: unknown): boolean {
  // Browsers hide CORS failures as TypeError from fetch(); Node has no window.
  if (typeof (globalThis as {window?: unknown}).window === 'undefined') return false;
  if (!(cause instanceof TypeError)) return false;
  const msg = cause.message.toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('fetch failed') ||
    msg.includes('load failed') ||
    msg.includes('networkerror') ||
    msg.includes('blocked by cors')
  );
}

function networkFailureMessage(path: string, attempts: number, cause: unknown): string {
  const base = `Request to ${path} failed after ${attempts} attempt(s)`;
  if (!isLikelyBrowserCorsFailure(cause)) return base;
  return (
    `${base}. The browser blocked this as a CORS failure — add this page's origin ` +
    `(scheme + host + port, e.g. http://localhost:3010) to the product's Allowed origins, ` +
    `or leave Allowed origins empty to allow any origin.`
  );
}

function parseRetryAfterSeconds(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

async function parseErrorDetail(response: Response): Promise<{code: string; message: string}> {
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return {code: 'unknown_error', message: response.statusText || `HTTP ${response.status}`};
  }

  const detail = (json as Record<string, unknown> | null)?.detail;

  // `{"detail": {"error": "...", "message": "..."}}` — every hand-written
  // HTTPException in the license/billing routers uses this shape.
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && 'error' in detail) {
    const {error, message} = detail as {error?: unknown; message?: unknown};
    return {
      code: typeof error === 'string' ? error : 'unknown_error',
      message: typeof message === 'string' ? message : response.statusText,
    };
  }

  // `{"detail": [{"msg": "...", "loc": [...]}, ...]}` — FastAPI/Pydantic's
  // own 422 shape for request validation errors, not a hand-written one.
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as {msg?: unknown} | undefined;
    return {
      code: 'validation_error',
      message: typeof first?.msg === 'string' ? first.msg : 'Request validation failed',
    };
  }

  return {code: 'unknown_error', message: response.statusText || `HTTP ${response.status}`};
}

/**
 * Perform one logical API call, retrying network errors / 429 / 5xx with
 * exponential backoff + jitter, and honouring a `Retry-After` header when
 * present. Throws {@link LicensrApiError} for any other non-2xx response,
 * or {@link LicensrNetworkError} once retries are exhausted.
 */
export async function requestJson<T>(config: HttpClientConfig, spec: RequestSpec): Promise<T> {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new LicensrNetworkError(
      'No fetch implementation available. Pass `fetchImpl` explicitly on Node < 18.',
      undefined
    );
  }
  const retry = {...DEFAULT_RETRY, ...config.retry};
  const url = buildUrl(config.baseUrl, spec.path, spec.query);

  for (let attempt = 0; ; attempt += 1) {
    const headers = new Headers({Authorization: `Bearer ${config.apiKey}`});
    if (spec.body !== undefined) headers.set('Content-Type', 'application/json');
    if (config.deviceId) headers.set(DEVICE_ID_HEADER, config.deviceId);
    if (config.origin) {
      try {
        headers.set('Origin', config.origin);
      } catch {
        // Forbidden header name in this runtime (real browsers) — the
        // browser already sends the caller's true Origin, so this is a
        // no-op rather than an error.
      }
    }

    const controller = config.timeoutMs !== undefined ? new AbortController() : undefined;
    const timeoutHandle =
      controller && config.timeoutMs !== undefined ? setTimeout(() => controller.abort(), config.timeoutMs) : undefined;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: spec.method,
        headers,
        body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
        signal: controller?.signal,
      });
    } catch (cause) {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (attempt < retry.maxRetries) {
        const delayMs = jitterDelayMs(attempt, retry.baseDelayMs, retry.maxDelayMs);
        spec.onRetry?.(attempt + 1, delayMs);
        await sleep(delayMs);
        continue;
      }
      throw new LicensrNetworkError(networkFailureMessage(spec.path, attempt + 1, cause), cause);
    }
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }

    const retriable = response.status === 429 || response.status >= 500;
    if (retriable && attempt < retry.maxRetries) {
      const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('Retry-After'));
      const delayMs =
        retryAfterSeconds !== null
          ? retryAfterSeconds * 1000
          : jitterDelayMs(attempt, retry.baseDelayMs, retry.maxDelayMs);
      spec.onRetry?.(attempt + 1, delayMs);
      await sleep(delayMs);
      continue;
    }

    const {code, message} = await parseErrorDetail(response);
    throw new LicensrApiError(
      response.status,
      code,
      message,
      parseRetryAfterSeconds(response.headers.get('Retry-After'))
    );
  }
}
