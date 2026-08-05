import {describe, expect, it} from 'vitest';
import {LicensrApiError, LicensrNetworkError, LicensrTokenVerificationError} from '../src/errors.js';

describe('LicensrApiError', () => {
  it('carries status, code, message, and retryAfterSeconds', () => {
    const error = new LicensrApiError(429, 'rate_limit_exceeded', 'Too many requests', 12);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('LicensrApiError');
    expect(error.status).toBe(429);
    expect(error.code).toBe('rate_limit_exceeded');
    expect(error.message).toBe('Too many requests');
    expect(error.retryAfterSeconds).toBe(12);
  });

  it('defaults retryAfterSeconds to null', () => {
    const error = new LicensrApiError(403, 'origin_not_allowed', 'nope');
    expect(error.retryAfterSeconds).toBeNull();
  });
});

describe('LicensrNetworkError', () => {
  it('preserves the underlying cause', () => {
    const cause = new Error('ECONNRESET');
    const error = new LicensrNetworkError('Request failed', cause);

    expect(error.name).toBe('LicensrNetworkError');
    expect(error.cause).toBe(cause);
  });
});

describe('LicensrTokenVerificationError', () => {
  it('is a plain, named Error', () => {
    const error = new LicensrTokenVerificationError('signature invalid');
    expect(error.name).toBe('LicensrTokenVerificationError');
    expect(error.message).toBe('signature invalid');
  });
});
