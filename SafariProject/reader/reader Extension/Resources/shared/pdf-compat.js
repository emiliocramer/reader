(function attachBoldLeadPdfCompat(global) {
  "use strict";

  if (typeof global.Promise.withResolvers !== "function") {
    global.Promise.withResolvers = function withResolvers() {
      let resolve;
      let reject;
      const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return {
        promise,
        resolve,
        reject
      };
    };
  }

  const ReadableStreamCtor = global.ReadableStream;
  if (!ReadableStreamCtor || !ReadableStreamCtor.prototype) {
    return;
  }

  async function* streamIterator(options) {
    const preventCancel = Boolean(options && options.preventCancel);
    const reader = this.getReader();

    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          return;
        }
        yield result.value;
      }
    } finally {
      if (!preventCancel && typeof reader.cancel === "function") {
        try {
          await reader.cancel();
        } catch (_error) {
          // Best-effort cancellation only.
        }
      }
      if (typeof reader.releaseLock === "function") {
        reader.releaseLock();
      }
    }
  }

  if (typeof ReadableStreamCtor.prototype.values !== "function") {
    Object.defineProperty(ReadableStreamCtor.prototype, "values", {
      configurable: true,
      writable: true,
      value: streamIterator
    });
  }

  if (
    typeof Symbol === "function" &&
    Symbol.asyncIterator &&
    typeof ReadableStreamCtor.prototype[Symbol.asyncIterator] !== "function"
  ) {
    Object.defineProperty(ReadableStreamCtor.prototype, Symbol.asyncIterator, {
      configurable: true,
      writable: true,
      value: function asyncIterator() {
        return this.values({ preventCancel: false });
      }
    });
  }
})(globalThis);
