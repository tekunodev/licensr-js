/**
 * Request/response shapes for the Licensr public license API.
 *
 * Mirrors ``contract/openapi.json`` (generated from the FastAPI backend —
 * see ``backend/services/models/license.py``). Keep in sync manually:
 * there is no codegen step, so any field added to the backend's response
 * models should be mirrored here.
 */

export type ActivationType = 'seat' | 'domain';
export type LicenseStatus = 'active' | 'inactive' | 'expired';
export type Entitlement = 'full' | 'limited' | 'none';

export interface ValidateRequest {
  licenseKey: string;
}

export interface ValidateResponse {
  valid: boolean;
  status: LicenseStatus;
  planId: string | null;
  planName: string | null;
  activationMode: ActivationType | null;
  maxSeats: number | null;
  maxDomains: number | null;
  seatsInUse: number | null;
  expiresAt: string | null;
  /** `full` when valid, `none` when cut off, `limited` alongside `fallback: true`. */
  entitlement: Entitlement;
  /** `true` only when an *expired* license is on a perpetual-fallback plan. */
  fallback: boolean;
  featureFlags: Record<string, unknown> | null;
}

export interface ActivateRequest {
  licenseKey: string;
  activationType: ActivationType;
  /** Stable per-install identifier: HWID for `seat`, hostname for `domain`. */
  identifier: string;
  /** Cosmetic, shown in admin/customer portals (e.g. "My MacBook Pro"). */
  label?: string | null;
}

export interface ActivateResponse {
  activationId: string;
  activationType: ActivationType;
  identifier: string;
  featureFlags: Record<string, unknown> | null;
}

export interface DeactivateRequest {
  licenseKey: string;
  activationId: string;
}

export interface DeactivateResponse {
  deactivated: boolean;
}

export interface ActivationListItem {
  activationId: string;
  activationType: ActivationType;
  identifier: string;
  label: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ActivationsRequest {
  licenseKey: string;
}

export interface ActivationsResponse {
  licenseId: string;
  activations: ActivationListItem[];
}

export interface TokenResponse {
  /** EdDSA-signed JWT — verify with {@link verifyOfflineToken} or `jose` directly. */
  token: string;
  algorithm: string;
  kid: string;
  issuedAt: string;
  expiresAt: string;
  jwksUrl: string;
}

/** Claims embedded in the offline token (`token`); mirrors {@link ValidateResponse}. */
export interface OfflineTokenClaims {
  sub: string;
  iss: string;
  iat: number;
  nbf: number;
  exp: number;
  plugin_slug: string;
  plan_id: string | null;
  status: LicenseStatus;
  valid: boolean;
  entitlement: Entitlement;
  fallback: boolean;
  activation_mode: ActivationType | null;
  max_seats: number | null;
  max_domains: number | null;
  license_expires_at: number | null;
  feature_flags: Record<string, unknown> | null;
}

export interface CheckoutRequest {
  planId: string;
  customerEmail: string;
  successUrl?: string | null;
  cancelUrl?: string | null;
}

export interface CheckoutResponse {
  checkoutUrl: string;
}

/** Every documented `detail.error` code from the license API — see contract/conformance.yaml. */
export type LicensrErrorCode =
  | 'missing_plugin_api_key'
  | 'invalid_plugin_api_key'
  | 'origin_not_allowed'
  | 'origin_not_activated'
  | 'plugin_mismatch'
  | 'license_inactive'
  | 'license_not_valid'
  | 'license_not_found'
  | 'activation_not_found'
  | 'activation_mode_mismatch'
  | 'activation_cap_exceeded'
  | 'jwks_path_deprecated'
  | 'rate_limit_exceeded'
  | 'insufficient_scope'
  | (string & {});

export interface ErrorBody {
  error: LicensrErrorCode;
  message?: string | null;
}
