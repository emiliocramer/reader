import assert from "node:assert/strict";
import { test } from "node:test";
import { createDom, loadScript } from "./helpers.js";

test("pdf compatibility shim adds Promise.withResolvers", () => {
  const dom = createDom();
  dom.window.Promise.withResolvers = undefined;

  loadScript(dom, "shared/pdf-compat.js");

  const capability = dom.window.Promise.withResolvers();
  assert.equal(typeof capability.promise.then, "function");
  assert.equal(typeof capability.resolve, "function");
  assert.equal(typeof capability.reject, "function");
});

test("pdf compatibility shim makes ReadableStream async iterable", async () => {
  const dom = createDom();
  class FakeReadableStream {
    constructor(values) {
      this._values = Array.from(values);
    }

    getReader() {
      const values = this._values.slice();
      return {
        read() {
          return Promise.resolve(
            values.length > 0
              ? {
                  done: false,
                  value: values.shift()
                }
              : {
                  done: true,
                  value: undefined
                }
          );
        },
        cancel() {
          return Promise.resolve();
        },
        releaseLock() {}
      };
    }
  }

  dom.window.ReadableStream = FakeReadableStream;

  loadScript(dom, "shared/pdf-compat.js");

  assert.equal(typeof FakeReadableStream.prototype.values, "function");
  assert.equal(typeof FakeReadableStream.prototype[Symbol.asyncIterator], "function");

  const stream = new FakeReadableStream(["one", "two"]);
  const values = [];

  for await (const value of stream) {
    values.push(value);
  }

  assert.deepEqual(values, ["one", "two"]);
});
