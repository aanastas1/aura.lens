import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { installAbortSignalThrowIfAborted } from '@/src/abortSignal';

// Each fake constructor has its own prototype, so tests never alter global signals.
function hermesSignal() {
  class Signal {
    aborted = false;
    reason: unknown;
  }
  installAbortSignalThrowIfAborted(Signal as unknown as typeof AbortSignal);
  return new Signal() as unknown as AbortSignal & { aborted: boolean; reason: unknown };
}

describe('AbortSignal compatibility for AI tool execution on Hermes', () => {
  it('continues with an active signal and throws the original cancellation reason', () => {
    const signal = hermesSignal();
    assert.doesNotThrow(() => signal.throwIfAborted());
    const reason = new Error('Cancelled by SOS');
    signal.aborted = true;
    signal.reason = reason;
    assert.throws(
      () => signal.throwIfAborted(),
      (error) => error === reason,
    );
    signal.reason = null;
    try {
      signal.throwIfAborted();
      assert.fail('An aborted signal must throw even when its reason is null');
    } catch (error) {
      assert.equal(error, null);
    }
  });

  it('uses AbortError when an older signal has no reason property', () => {
    const signal = hermesSignal();
    signal.aborted = true;
    Reflect.deleteProperty(signal, 'reason');
    assert.throws(() => signal.throwIfAborted(), { name: 'AbortError' });
  });

  it('preserves an existing platform implementation', () => {
    class Signal {
      throwIfAborted() {}
    }
    const original = Signal.prototype.throwIfAborted;
    installAbortSignalThrowIfAborted(Signal as unknown as typeof AbortSignal);
    assert.equal(Signal.prototype.throwIfAborted, original);
  });
});
