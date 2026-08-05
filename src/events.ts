import type {ActivateResponse, DeactivateResponse, TokenResponse, ValidateResponse} from './types.js';

/** Lifecycle events emitted by {@link import('./client.js').LicensrClient}. */
export interface LicensrEventMap {
  validated: ValidateResponse;
  activated: ActivateResponse;
  deactivated: DeactivateResponse;
  tokenIssued: TokenResponse;
  /** Fired on every retried request, before the retry delay. */
  retry: {method: string; attempt: number; delayMs: number};
  /** Fired whenever a client method throws, right before the error propagates. */
  error: {method: string; error: unknown};
}

type Listener<T> = (payload: T) => void;

/**
 * Minimal, dependency-free typed event emitter for {@link LicensrEventMap}
 * — no Node `EventEmitter` import so the SDK stays usable unmodified in
 * browsers.
 */
export class LicensrEventEmitter {
  private readonly listeners = new Map<keyof LicensrEventMap, Set<Listener<never>>>();

  /** Returns an unsubscribe function. */
  on<K extends keyof LicensrEventMap>(event: K, listener: Listener<LicensrEventMap[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  off<K extends keyof LicensrEventMap>(event: K, listener: Listener<LicensrEventMap[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof LicensrEventMap>(event: K, payload: LicensrEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) (listener as Listener<LicensrEventMap[K]>)(payload);
  }
}
