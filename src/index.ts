export {LicensrClient, type LicensrClientConfig} from './client.js';
export {LicensrApiError, LicensrNetworkError, LicensrTokenVerificationError} from './errors.js';
export {LicensrEventEmitter, type LicensrEventMap} from './events.js';
export {DEVICE_ID_HEADER, type HttpClientConfig, type RetryOptions} from './http.js';
export {
  InMemoryOfflineTokenStore,
  clearJwksCache,
  verifyOfflineToken,
  type CachedOfflineToken,
  type OfflineTokenStore,
  type VerifyOfflineTokenOptions,
} from './offline.js';
export type {
  ActivateRequest,
  ActivateResponse,
  ActivationListItem,
  ActivationsRequest,
  ActivationsResponse,
  ActivationType,
  CheckoutRequest,
  CheckoutResponse,
  DeactivateRequest,
  DeactivateResponse,
  Entitlement,
  ErrorBody,
  LicenseStatus,
  LicensrErrorCode,
  OfflineTokenClaims,
  TokenResponse,
  ValidateRequest,
  ValidateResponse,
} from './types.js';
