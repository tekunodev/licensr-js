import {describe, expect, it} from 'vitest';
import {
  fromActivateWire,
  fromActivationsWire,
  fromCheckoutWire,
  fromDeactivateWire,
  fromTokenWire,
  fromValidateWire,
} from '../src/wire.js';

describe('wire mappers', () => {
  it('fromValidateWire maps every snake_case field to camelCase', () => {
    expect(
      fromValidateWire({
        valid: true,
        status: 'active',
        entitlement: 'full',
        feature_flags: {beta: true},
        license: {
          plan_id: 'plan-1',
          activation_mode: 'seat',
          max_seats: 5,
          max_domains: null,
          seats_in_use: 1,
          expires_at: '2027-01-01T00:00:00Z',
        },
      })
    ).toEqual({
      valid: true,
      status: 'active',
      entitlement: 'full',
      featureFlags: {beta: true},
      license: {
        planId: 'plan-1',
        activationMode: 'seat',
        maxSeats: 5,
        maxDomains: null,
        seatsInUse: 1,
        expiresAt: '2027-01-01T00:00:00Z',
      },
    });
  });

  it('fromTokenWire maps every snake_case field to camelCase', () => {
    expect(
      fromTokenWire({
        token: 'jwt',
        details: {
          algorithm: 'EdDSA',
          kid: 'kid-1',
          issued_at: '2027-01-01T00:00:00Z',
          expires_at: '2027-02-01T00:00:00Z',
          jwks_url: 'https://api.licensr.app/v1/license/jwks/acme/demo.json',
        },
      })
    ).toEqual({
      token: 'jwt',
      details: {
        algorithm: 'EdDSA',
        kid: 'kid-1',
        issuedAt: '2027-01-01T00:00:00Z',
        expiresAt: '2027-02-01T00:00:00Z',
        jwksUrl: 'https://api.licensr.app/v1/license/jwks/acme/demo.json',
      },
    });
  });

  it('fromActivateWire maps every snake_case field to camelCase', () => {
    expect(
      fromActivateWire({
        activation_id: 'act-1',
        feature_flags: null,
        activation: {type: 'seat', identifier: 'hwid-1'},
      })
    ).toEqual({
      activationId: 'act-1',
      featureFlags: null,
      activation: {type: 'seat', identifier: 'hwid-1'},
    });
  });

  it('fromDeactivateWire maps deactivated', () => {
    expect(fromDeactivateWire({deactivated: true})).toEqual({deactivated: true});
  });

  it('fromActivationsWire maps the license id and each activation list item', () => {
    expect(
      fromActivationsWire({
        license_id: 'lic-1',
        activations: [
          {
            activation_id: 'act-1',
            activation_type: 'domain',
            identifier: 'example.com',
            label: 'Prod',
            first_seen_at: '2027-01-01T00:00:00Z',
            last_seen_at: '2027-01-02T00:00:00Z',
          },
        ],
      })
    ).toEqual({
      licenseId: 'lic-1',
      activations: [
        {
          activationId: 'act-1',
          activationType: 'domain',
          identifier: 'example.com',
          label: 'Prod',
          firstSeenAt: '2027-01-01T00:00:00Z',
          lastSeenAt: '2027-01-02T00:00:00Z',
        },
      ],
    });
  });

  it('fromCheckoutWire maps checkout_url', () => {
    expect(fromCheckoutWire({checkout_url: 'https://checkout.stripe.com/session/1'})).toEqual({
      checkoutUrl: 'https://checkout.stripe.com/session/1',
    });
  });

  it('fromCheckoutWire maps test_clock_id and drops a null one', () => {
    expect(fromCheckoutWire({checkout_url: 'https://c.test/1', test_clock_id: 'clock_123'})).toEqual({
      checkoutUrl: 'https://c.test/1',
      testClockId: 'clock_123',
    });
    expect(fromCheckoutWire({checkout_url: 'https://c.test/1', test_clock_id: null})).toStrictEqual({
      checkoutUrl: 'https://c.test/1',
    });
  });
});
