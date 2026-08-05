import {describe, expect, it, vi} from 'vitest';
import {LicensrEventEmitter} from '../src/events.js';

describe('LicensrEventEmitter', () => {
  it('calls every listener registered for an event, with the emitted payload', () => {
    const emitter = new LicensrEventEmitter();
    const a = vi.fn();
    const b = vi.fn();
    emitter.on('validated', a);
    emitter.on('validated', b);

    const payload = {
      valid: true,
      status: 'active',
      planId: null,
      planName: null,
      activationMode: null,
      maxSeats: null,
      maxDomains: null,
      seatsInUse: null,
      expiresAt: null,
      entitlement: 'full',
      fallback: false,
      featureFlags: null,
    } as const;
    emitter.emit('validated', payload);

    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(payload);
    expect(b).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith(payload);
  });

  it('does not call listeners registered for a different event', () => {
    const emitter = new LicensrEventEmitter();
    const listener = vi.fn();
    emitter.on('error', listener);

    emitter.emit('retry', {method: 'validate', attempt: 1, delayMs: 100});

    expect(listener).not.toHaveBeenCalled();
  });

  it('off() removes a specific listener without affecting others', () => {
    const emitter = new LicensrEventEmitter();
    const removed = vi.fn();
    const kept = vi.fn();
    emitter.on('error', removed);
    emitter.on('error', kept);

    emitter.off('error', removed);
    emitter.emit('error', {method: 'validate', error: new Error('boom')});

    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledOnce();
  });

  it('on() returns an unsubscribe function', () => {
    const emitter = new LicensrEventEmitter();
    const listener = vi.fn();
    const unsubscribe = emitter.on('error', listener);

    unsubscribe();
    emitter.emit('error', {method: 'validate', error: new Error('boom')});

    expect(listener).not.toHaveBeenCalled();
  });

  it('emitting with no listeners registered is a no-op', () => {
    const emitter = new LicensrEventEmitter();
    expect(() => emitter.emit('error', {method: 'validate', error: new Error('boom')})).not.toThrow();
  });
});
