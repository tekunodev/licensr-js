/**
 * snake_case wire shapes for the license API and their mappers to/from the
 * SDK's public camelCase types. Kept explicit (no generic deep-casing) so
 * opaque, plugin-defined maps like `featureFlags` are never mangled.
 */
import type {
  ActivateResponse,
  ActivationListItem,
  ActivationsResponse,
  ActivationType,
  CheckoutResponse,
  DeactivateResponse,
  Entitlement,
  LicenseStatus,
  TokenResponse,
  ValidateResponse,
} from './types.js';

export interface ValidateResponseWire {
  valid: boolean;
  status: LicenseStatus;
  entitlement: Entitlement;
  feature_flags: Record<string, unknown> | null;
  license: {
    plan_id: string | null;
    activation_mode: ActivationType | null;
    max_seats: number | null;
    max_domains: number | null;
    seats_in_use: number | null;
    expires_at: string | null;
  };
}

export function fromValidateWire(wire: ValidateResponseWire): ValidateResponse {
  return {
    valid: wire.valid,
    status: wire.status,
    entitlement: wire.entitlement,
    featureFlags: wire.feature_flags,
    license: {
      planId: wire.license.plan_id,
      activationMode: wire.license.activation_mode,
      maxSeats: wire.license.max_seats,
      maxDomains: wire.license.max_domains,
      seatsInUse: wire.license.seats_in_use,
      expiresAt: wire.license.expires_at,
    },
  };
}

export interface TokenResponseWire {
  token: string;
  details: {
    algorithm: string;
    kid: string;
    issued_at: string;
    expires_at: string;
    jwks_url: string;
  };
}

export function fromTokenWire(wire: TokenResponseWire): TokenResponse {
  return {
    token: wire.token,
    details: {
      algorithm: wire.details.algorithm,
      kid: wire.details.kid,
      issuedAt: wire.details.issued_at,
      expiresAt: wire.details.expires_at,
      jwksUrl: wire.details.jwks_url,
    },
  };
}

export interface ActivateResponseWire {
  activation_id: string;
  feature_flags: Record<string, unknown> | null;
  activation: {type: ActivationType; identifier: string};
}

export function fromActivateWire(wire: ActivateResponseWire): ActivateResponse {
  return {
    activationId: wire.activation_id,
    featureFlags: wire.feature_flags,
    activation: {type: wire.activation.type, identifier: wire.activation.identifier},
  };
}

export interface DeactivateResponseWire {
  deactivated: boolean;
}

export function fromDeactivateWire(wire: DeactivateResponseWire): DeactivateResponse {
  return {deactivated: wire.deactivated};
}

export interface ActivationListItemWire {
  activation_id: string;
  activation_type: ActivationType;
  identifier: string;
  label: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface ActivationsResponseWire {
  license_id: string;
  activations: ActivationListItemWire[];
}

function fromActivationListItemWire(wire: ActivationListItemWire): ActivationListItem {
  return {
    activationId: wire.activation_id,
    activationType: wire.activation_type,
    identifier: wire.identifier,
    label: wire.label,
    firstSeenAt: wire.first_seen_at,
    lastSeenAt: wire.last_seen_at,
  };
}

export function fromActivationsWire(wire: ActivationsResponseWire): ActivationsResponse {
  return {
    licenseId: wire.license_id,
    activations: wire.activations.map(fromActivationListItemWire),
  };
}

export interface CheckoutResponseWire {
  checkout_url: string;
}

export function fromCheckoutWire(wire: CheckoutResponseWire): CheckoutResponse {
  return {checkoutUrl: wire.checkout_url};
}
