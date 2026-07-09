import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { JSDOM } from "jsdom";

const root = process.cwd();

function load(dom, path) {
  dom.window.eval(readFileSync(join(root, path), "utf8"));
}

function flush(dom) {
  return new Promise((resolve) => dom.window.setTimeout(resolve, 30));
}

function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
    trigger(...args) {
      for (const listener of listeners) {
        listener(...args);
      }
    }
  };
}

function createBackgroundRuntime() {
  const dom = new JSDOM("<!doctype html>", {
    url: "https://example.test/",
    runScripts: "outside-only"
  });
  const runtimeOnMessage = createEvent();
  const onCommitted = createEvent();
  const onRemoved = createEvent();
  const storageOnChanged = createEvent();
  const reloads = [];
  const insertedCss = [];
  const executedScripts = [];

  dom.window.chrome = {
    runtime: {
      onMessage: runtimeOnMessage
    },
    storage: {
      local: {
        get(defaults, callback) {
          callback(defaults);
        }
      },
      onChanged: storageOnChanged
    },
    tabs: {
      reload(tabId) {
        reloads.push(tabId);
      },
      onRemoved
    },
    webNavigation: {
      onCommitted
    },
    scripting: {
      insertCSS(args) {
        insertedCss.push(args);
      },
      executeScript(args) {
        executedScripts.push(args);
      }
    }
  };

  dom.window.importScripts = (...paths) => {
    for (const path of paths) {
      load(dom, path.replace(/^\.\.\//, ""));
    }
  };

  load(dom, "background/background.js");

  function sendMessage(message, sender = {}) {
    let response;
    for (const listener of runtimeOnMessage.listeners) {
      listener(message, sender, (value) => {
        response = value;
      });
    }
    return response;
  }

  return {
    dom,
    onCommitted,
    onRemoved,
    reloads,
    insertedCss,
    executedScripts,
    sendMessage
  };
}

test("content script exits before connecting when the tab page session is disabled", async () => {
  const dom = new JSDOM("<!doctype html><html><body><p>visible words here</p></body></html>", {
    url: "https://example.test/",
    pretendToBeVisual: true,
    runScripts: "outside-only"
  });
  const sentMessages = [];
  let storageWasRead = false;

  dom.window.chrome = {
    runtime: {
      getURL(path) {
        return "safari-web-extension://reader/" + path;
      },
      sendMessage(message, callback) {
        sentMessages.push(message);
        callback({ disabled: message.type === "boldlead-page-session-state" });
      }
    },
    storage: {
      local: {
        get(_defaults, callback) {
          storageWasRead = true;
          callback({ enabled: true });
        }
      }
    }
  };

  load(dom, "shared/browser-api.js");
  load(dom, "shared/config.js");
  load(dom, "shared/pdf-routing.js");
  load(dom, "shared/reader-engine.js");
  load(dom, "content/content.js");
  await flush(dom);

  assert.equal(dom.window.__boldLeadReaderSessionDisabled, true);
  assert.equal(storageWasRead, false);
  assert.equal(dom.window.document.querySelectorAll("[data-boldlead-word]").length, 0);
  assert.deepEqual(sentMessages.map((message) => message.type), ["boldlead-page-session-state"]);
});

test("background disables one tab session and clears it on the next explicit reload", () => {
  const runtime = createBackgroundRuntime();
  const tabId = 12;
  const url = "https://example.test/";

  let response = runtime.sendMessage({
    type: "boldlead-disable-page-session",
    tabId,
    url
  });
  assert.equal(response && response.ok, true);
  assert.deepEqual(runtime.reloads, [tabId]);

  response = runtime.sendMessage(
    {
      type: "boldlead-page-session-state",
      topFrame: true,
      url,
      navigationType: "reload"
    },
    { tab: { id: tabId }, frameId: 0 }
  );
  assert.equal(response && response.disabled, true);

  response = runtime.sendMessage(
    {
      type: "boldlead-page-session-state",
      topFrame: true,
      url: url + "login",
      navigationType: "navigate"
    },
    { tab: { id: tabId }, frameId: 0 }
  );
  assert.equal(response && response.disabled, true);

  response = runtime.sendMessage(
    {
      type: "boldlead-page-session-state",
      topFrame: true,
      url: url + "login",
      navigationType: "reload"
    },
    { tab: { id: tabId }, frameId: 0 }
  );
  assert.equal(response && response.disabled, false);
});

test("background skips reinjection while a page session is disabled", () => {
  const runtime = createBackgroundRuntime();
  const tabId = 18;
  const url = "https://example.test/";

  runtime.sendMessage({
    type: "boldlead-disable-page-session",
    tabId,
    url
  });

  runtime.onCommitted.trigger({
    tabId,
    frameId: 0,
    url,
    transitionType: "reload"
  });
  assert.equal(runtime.executedScripts.length, 0);

  runtime.sendMessage(
    {
      type: "boldlead-page-session-state",
      topFrame: true,
      url,
      navigationType: "reload"
    },
    { tab: { id: tabId }, frameId: 0 }
  );

  runtime.onCommitted.trigger({
    tabId,
    frameId: 0,
    url: url + "login",
    transitionType: "link"
  });
  assert.equal(runtime.executedScripts.length, 0);

  runtime.onCommitted.trigger({
    tabId,
    frameId: 0,
    url: url + "login",
    transitionType: "reload"
  });
  assert.equal(runtime.executedScripts.length, 1);
  assert.equal(runtime.insertedCss.length, 1);
});
