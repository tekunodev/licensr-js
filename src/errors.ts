import type {LicensrErrorCode} from './types.js';

/**
 * The API responded with a non-2xx status and a parsed `detail.error` body.
 *
 * `code` is one of the documented error codes in `contract/conformance.yaml`
 * (e.g. `license_inactive`, `origin_not_allowed`, `rate_limit_exceeded`).
 * Branch on `code`, not on `message` — the message is for humans and may
 * change without notice.
 */
export class LicensrApiError extends Error {
  readonly status: number;
  readonly code: LicensrErrorCode;
  /** Present on 429 responses when the server sends `Retry-After`. */
  readonly retryAfterSeconds: number | null;

  constructor(status: number, code: LicensrErrorCode, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'LicensrApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The request never got a response — network failure, timeout, or abort. */
export class LicensrNetworkError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'LicensrNetworkError';
    this.cause = cause;
  }
}

/** An offline token failed EdDSA verification, was malformed, or has expired. */
export class LicensrTokenVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LicensrTokenVerificationError';
  }
}
