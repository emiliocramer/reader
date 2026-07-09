import assert from "node:assert/strict";
import { test } from "node:test";
import { createDom, loadScript } from "./helpers.js";

test("runtimeSendMessage sends extension-level messages", async () => {
  const dom = createDom();
  const sentMessages = [];

  dom.window.chrome = {
    runtime: {
      sendMessage(message, callback) {
        sentMessages.push(message);
        callback({ ok: true });
      }
    }
  };

  loadScript(dom, "shared/browser-api.js");

  const response = await dom.window.BoldLeadExtensionAPI.runtimeSendMessage({
    type: "boldlead-open-original-pdf"
  });

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(sentMessages, [{ type: "boldlead-open-original-pdf" }]);
});
