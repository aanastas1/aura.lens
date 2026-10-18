// Expo supplies AbortSignal.any/timeout, but Hermes also needs this instance method
// when the AI SDK runs tools or advances to another model step.
export function installAbortSignalThrowIfAborted(Signal = AbortSignal) {
  if (typeof Signal.prototype.throwIfAborted === 'function') return;
  Object.defineProperty(Signal.prototype, 'throwIfAborted', {
    configurable: true,
    writable: true,
    value(this: AbortSignal) {
      if (!this.aborted) return;
      if ('reason' in this) throw this.reason;
      throw new DOMException('The operation was aborted.', 'AbortError');
    },
  });
}
