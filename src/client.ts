import {LicensrEventEmitter} from './events.js';
import {requestJson, type HttpClientConfig, type RetryOptions} from './http.js';
import type {
  ActivateRequest,
  ActivateResponse,
  ActivationsRequest,
  ActivationsResponse,
  CheckoutRequest,
  CheckoutResponse,
  DeactivateRequest,
  DeactivateResponse,
  TokenResponse,
  ValidateRequest,
  ValidateResponse,
} from './types.js';
import {
  fromActivateWire,
  fromActivationsWire,
  fromCheckoutWire,
  fromDeactivateWire,
  fromTokenWire,
  fromValidateWire,
  type ActivateResponseWire,
  type ActivationsResponseWire,
  type CheckoutResponseWire,
  type DeactivateResponseWire,
  type TokenResponseWire,
  type ValidateResponseWire,
} from './wire.js';

export interface LicensrClientConfig {
  /**
   * Plugin API key (`pk_live_...` / `pk_test_...`).
   * Admin → Catalog → your product → **API keys**. Issue a **Client** key to
   * embed in a browser or shipped app (it cannot open checkout).
   */
  apiKey: string;
  /**
   * Product slug from Admin → Catalog (the same value on the product row).
   * Sent as `plugin_slug` on every license call.
   */
  pluginSlug: string;
  /** Defaults to `https://api.licensr.app`. Override for self-hosted/staging. */
  baseUrl?: string;
  /** See {@link HttpClientConfig.origin}. */
  origin?: string;
  /** Stable per-install identifier, e.g. the same HWID used for `activate()`. Buckets rate limits per installation instead of per key. */
  deviceId?: string;
  /** Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retry?: RetryOptions;
}

/**
 * Thin client for the Licensr public license API
 * (`/v1/license/*`, `/v1/billing/checkout`).
 *
 * ```ts
 * const client = new LicensrClient({apiKey: 'pk_live_...', pluginSlug: 'my-plugin'});
 * const result = await client.validate({licenseKey});
 * if (result.valid) { ... }
 * ```
 *
 * Subscribe to lifecycle events via `client.events`:
 *
 * ```ts
 * client.events.on('error', ({method, error}) => log(method, error));
 * ```
 */
export class LicensrClient {
  readonly events = new LicensrEventEmitter();
  private readonly http: HttpClientConfig;
  private readonly pluginSlug: string;

  constructor(config: LicensrClientConfig) {
    this.pluginSlug = config.pluginSlug;
    this.http = {
      baseUrl: config.baseUrl ?? 'https://api.licensr.app',
      apiKey: config.apiKey,
      origin: config.origin,
      deviceId: config.deviceId,
      fetchImpl: config.fetchImpl,
      timeoutMs: config.timeoutMs,
      retry: config.retry,
    };
  }

  /** Check whether a license is valid for this plugin, without minting an offline token. */
  async validate(req: ValidateRequest): Promise<ValidateResponse> {
    return this.run('validate', async () => {
      const wire = await requestJson<ValidateResponseWire>(this.http, {
        method: 'POST',
        path: 'v1/license/validate',
        body: {license_key: req.licenseKey, plugin_slug: this.pluginSlug},
        onRetry: this.onRetry('validate'),
      });
      return fromValidateWire(wire);
    });
  }

  /**
   * Run the same check as {@link validate}, and on success mint a
   * short-lived EdDSA-signed offline token. Verify it with
   * {@link import('./offline.js').verifyOfflineToken} — no network call
   * needed after the first successful fetch of the plugin's JWKS.
   */
  async token(req: ValidateRequest): Promise<TokenResponse> {
    return this.run('token', async () => {
      const wire = await requestJson<TokenResponseWire>(this.http, {
        method: 'POST',
        path: 'v1/license/token',
        body: {license_key: req.licenseKey, plugin_slug: this.pluginSlug},
        onRetry: this.onRetry('token'),
      });
      return fromTokenWire(wire);
    });
  }

  /** Activate a seat (per-machine HWID) or domain for a license. */
  async activate(req: ActivateRequest): Promise<ActivateResponse> {
    return this.run('activate', async () => {
      const wire = await requestJson<ActivateResponseWire>(this.http, {
        method: 'POST',
        path: 'v1/license/activate',
        body: {
          license_key: req.licenseKey,
          plugin_slug: this.pluginSlug,
          activation_type: req.activationType,
          identifier: req.identifier,
          label: req.label ?? null,
        },
        onRetry: this.onRetry('activate'),
      });
      return fromActivateWire(wire);
    });
  }

  /** Release a previously created activation, freeing its seat/domain slot. */
  async deactivate(req: DeactivateRequest): Promise<DeactivateResponse> {
    return this.run('deactivate', async () => {
      const wire = await requestJson<DeactivateResponseWire>(this.http, {
        method: 'POST',
        path: 'v1/license/deactivate',
        body: {license_key: req.licenseKey, activation_id: req.activationId},
        onRetry: this.onRetry('deactivate'),
      });
      return fromDeactivateWire(wire);
    });
  }

  /** List every current activation for a license (seats/domains in use). */
  async activations(req: ActivationsRequest): Promise<ActivationsResponse> {
    return this.run('activations', async () => {
      const wire = await requestJson<ActivationsResponseWire>(this.http, {
        method: 'GET',
        path: 'v1/license/activations',
        query: {license_key: req.licenseKey, plugin_slug: this.pluginSlug},
        onRetry: this.onRetry('activations'),
      });
      return fromActivationsWire(wire);
    });
  }

  /** Start a hosted checkout session for a plan; redirect the user to the returned URL. */
  async checkout(req: CheckoutRequest): Promise<CheckoutResponse> {
    return this.run('checkout', async () => {
      const wire = await requestJson<CheckoutResponseWire>(this.http, {
        method: 'POST',
        path: 'v1/billing/checkout',
        body: {
          plan_id: req.planId,
          customer_email: req.customerEmail,
          success_url: req.successUrl ?? null,
          cancel_url: req.cancelUrl ?? null,
          // Sent only when asked for, so servers without test clocks see the same body.
          ...(req.testClock ? {test_clock: true} : {}),
        },
        onRetry: this.onRetry('checkout'),
      });
      return fromCheckoutWire(wire);
    });
  }

  private onRetry(method: string): (attempt: number, delayMs: number) => void {
    return (attempt, delayMs) => this.events.emit('retry', {method, attempt, delayMs});
  }

  private async run<T>(method: string, fn: () => Promise<T>): Promise<T> {
    try {
      const result = await fn();
      this.emitResult(method, result);
      return result;
    } catch (error) {
      this.events.emit('error', {method, error});
      throw error;
    }
  }

  private emitResult(method: string, result: unknown): void {
    switch (method) {
      case 'validate':
        this.events.emit('validated', result as ValidateResponse);
        break;
      case 'activate':
        this.events.emit('activated', result as ActivateResponse);
        break;
      case 'deactivate':
        this.events.emit('deactivated', result as DeactivateResponse);
        break;
      case 'token':
        this.events.emit('tokenIssued', result as TokenResponse);
        break;
      default:
        break;
    }
  }
}
