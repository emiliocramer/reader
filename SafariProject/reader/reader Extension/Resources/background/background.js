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
    "shared/reader-engine.js",
    "content/content.js"
  ];
  const contentStyleFiles = ["content/reader.css"];

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

  function injectReader(details) {
    if (
      !currentSettings.enabled ||
      !details ||
      typeof details.tabId !== "number" ||
      details.tabId < 0 ||
      !canInjectUrl(details.url) ||
      !API.raw.scripting
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
})(globalThis);
