importScripts(
  "../shared/browser-api.js",
  "../shared/config.js"
);

(function startBoldLeadBackground(global) {
  "use strict";

  const API = global.BoldLeadExtensionAPI;
  const Config = global.BoldLeadReaderConfig;

  if (!API || !API.raw || !Config) {
    return;
  }

  let currentSettings = Config.normalizeSettings(Config.DEFAULT_SETTINGS);
  const contentScriptFiles = [
    "shared/browser-api.js",
    "shared/config.js",
    "shared/pdf-routing.js",
    "vendor/pdf-lib/pdf-lib.js",
    "shared/pdf-bionicize.js",
    "shared/reader-engine.js",
    "content/content.js"
  ];
  const contentStyleFiles = ["content/reader.css"];
  const disabledPageSessions = new Map();

  API.storageGet(Config.DEFAULT_SETTINGS)
    .then((storedSettings) => {
      currentSettings = Config.normalizeSettings(storedSettings);
    })
    .catch(() => {
      currentSettings = Config.normalizeSettings(Config.DEFAULT_SETTINGS);
    });

  if (API.raw.storage && API.raw.storage.onChanged) {
    API.raw.storage.onChanged.addListener((changes, areaName) => {
      if (areaName && areaName !== "local") {
        return;
      }

      const nextSettings = Object.assign({}, currentSettings);
      for (const key of Object.keys(Config.DEFAULT_SETTINGS)) {
        if (changes[key]) {
          nextSettings[key] = changes[key].newValue;
        }
      }
      currentSettings = Config.normalizeSettings(nextSettings);
    });
  }

  function canInjectUrl(url) {
    return /^(https?|file):/i.test(String(url || ""));
  }

  function tabIdFromSender(sender) {
    return sender && sender.tab && typeof sender.tab.id === "number" ? sender.tab.id : -1;
  }

  function tabIdFromMessage(message, sender) {
    if (message && typeof message.tabId === "number") {
      return message.tabId;
    }
    return tabIdFromSender(sender);
  }

  function isTopFrameMessage(message, sender) {
    if (message && typeof message.topFrame === "boolean") {
      return message.topFrame;
    }
    return !sender || !Number.isInteger(sender.frameId) || sender.frameId === 0;
  }

  function isReloadNavigation(value) {
    return String(value || "").toLowerCase() === "reload";
  }

  function setDisabledPageSession(tabId, url) {
    if (typeof tabId !== "number" || tabId < 0) {
      return false;
    }

    disabledPageSessions.set(tabId, {
      active: false,
      createdAt: Date.now(),
      url: String(url || "")
    });
    return true;
  }

  function clearDisabledPageSession(tabId) {
    disabledPageSessions.delete(tabId);
  }

  function shouldSkipForDisabledPageSession(details) {
    if (!details || typeof details.tabId !== "number") {
      return false;
    }

    const session = disabledPageSessions.get(details.tabId);
    if (!session) {
      return false;
    }

    if ((details.frameId || 0) === 0 && session.active && isReloadNavigation(details.transitionType)) {
      clearDisabledPageSession(details.tabId);
      return false;
    }

    return true;
  }

  function disabledStateForContent(message, sender) {
    const tabId = tabIdFromMessage(message, sender);
    if (tabId < 0) {
      return false;
    }

    const session = disabledPageSessions.get(tabId);
    if (!session) {
      return false;
    }

    if (isTopFrameMessage(message, sender)) {
      if (!session.active) {
        session.active = true;
        return true;
      }

      if (isReloadNavigation(message && message.navigationType)) {
        clearDisabledPageSession(tabId);
        return false;
      }
    }

    return true;
  }

  function reloadTab(tabId, url) {
    if (!API.raw.tabs) {
      return;
    }

    if (typeof API.raw.tabs.reload === "function") {
      try {
        const result = API.raw.tabs.reload(tabId);
        if (result && typeof result.catch === "function") {
          result.catch(() => {});
        }
        return;
      } catch (_error) {
        // Fall through to a URL update when reload is unavailable.
      }
    }

    if (url && typeof API.raw.tabs.update === "function") {
      try {
        const result = API.raw.tabs.update(tabId, { url });
        if (result && typeof result.catch === "function") {
          result.catch(() => {});
        }
      } catch (_error) {
        // Ignore tabs that disappear before the reload is issued.
      }
    }
  }

  function injectReader(details) {
    if (
      !currentSettings.enabled ||
      !details ||
      typeof details.tabId !== "number" ||
      details.tabId < 0 ||
      !canInjectUrl(details.url) ||
      !API.raw.scripting ||
      shouldSkipForDisabledPageSession(details)
    ) {
      return;
    }

    const target = {
      tabId: details.tabId,
      frameIds: [details.frameId || 0]
    };

    if (typeof API.raw.scripting.insertCSS === "function") {
      try {
        const result = API.raw.scripting.insertCSS({
          target,
          files: contentStyleFiles
        });
        if (result && typeof result.catch === "function") {
          result.catch(() => {});
        }
      } catch (_error) {
        // Some frames are intentionally not scriptable.
      }
    }

    if (typeof API.raw.scripting.executeScript === "function") {
      try {
        const result = API.raw.scripting.executeScript({
          target,
          files: contentScriptFiles
        });
        if (result && typeof result.catch === "function") {
          result.catch(() => {});
        }
      } catch (_error) {
        // Ignore non-scriptable frames and browser-owned pages.
      }
    }
  }

  if (API.raw.webNavigation && API.raw.webNavigation.onCommitted) {
    API.raw.webNavigation.onCommitted.addListener(
      (details) => {
        injectReader(details);
      },
      {
        url: [
          { schemes: ["http"] },
          { schemes: ["https"] },
          { schemes: ["file"] }
        ]
      }
    );
  }

  if (API.raw.runtime && API.raw.runtime.onMessage) {
    API.raw.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message.type !== "string") {
        return false;
      }

      if (message.type === "boldlead-disable-page-session") {
        const tabId = tabIdFromMessage(message, sender);
        const ok = setDisabledPageSession(tabId, message.url);
        if (ok) {
          reloadTab(tabId, message.url);
        }
        if (typeof sendResponse === "function") {
          sendResponse({ ok });
        }
        return false;
      }

      if (message.type === "boldlead-page-session-state") {
        if (typeof sendResponse === "function") {
          sendResponse({
            disabled: disabledStateForContent(message, sender)
          });
        }
        return false;
      }

      return false;
    });
  }

  if (API.raw.tabs && API.raw.tabs.onRemoved) {
    API.raw.tabs.onRemoved.addListener((tabId) => {
      clearDisabledPageSession(tabId);
    });
  }
})(globalThis);
