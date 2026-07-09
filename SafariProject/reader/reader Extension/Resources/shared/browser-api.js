(function attachBoldLeadExtensionAPI(global) {
  "use strict";

  const raw = global.browser || global.chrome || null;

  function runtimeLastError() {
    return raw && raw.runtime && raw.runtime.lastError
      ? raw.runtime.lastError
      : null;
  }

  function invoke(context, method, args) {
    if (!context || typeof context[method] !== "function") {
      return Promise.resolve(undefined);
    }

    if (global.browser) {
      try {
        const result = context[method](...args);
        if (result && typeof result.then === "function") {
          return result;
        }
        if (result !== undefined) {
          return Promise.resolve(result);
        }
      } catch (error) {
        return invokeWithCallback(context, method, args);
      }
    }

    return invokeWithCallback(context, method, args);
  }

  function invokeWithCallback(context, method, args) {
    return new Promise((resolve, reject) => {
      try {
        context[method](...args, (...callbackArgs) => {
          const error = runtimeLastError();
          if (error) {
            reject(new Error(error.message || String(error)));
            return;
          }
          resolve(callbackArgs.length > 1 ? callbackArgs : callbackArgs[0]);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageGet(defaults) {
    const storage = raw && raw.storage && raw.storage.local;
    if (!storage) {
      return Promise.resolve(defaults || {});
    }
    return invoke(storage, "get", [defaults || {}]).then((items) => items || defaults || {});
  }

  function storageSet(values) {
    const storage = raw && raw.storage && raw.storage.local;
    if (!storage) {
      return Promise.resolve(undefined);
    }
    return invoke(storage, "set", [values || {}]);
  }

  function tabsQuery(queryInfo) {
    const tabs = raw && raw.tabs;
    if (!tabs) {
      return Promise.resolve([]);
    }
    return invoke(tabs, "query", [queryInfo || {}]).then((items) => items || []);
  }

  function tabsUpdate(tabId, updateProperties) {
    const tabs = raw && raw.tabs;
    if (!tabs) {
      return Promise.resolve(undefined);
    }
    return invoke(tabs, "update", [tabId, updateProperties]);
  }

  function sendMessage(tabId, message) {
    const tabs = raw && raw.tabs;
    if (!tabs) {
      return Promise.resolve(undefined);
    }
    return invoke(tabs, "sendMessage", [tabId, message]);
  }

  function runtimeSendMessage(message) {
    const runtime = raw && raw.runtime;
    if (!runtime) {
      return Promise.resolve(undefined);
    }
    return invoke(runtime, "sendMessage", [message]);
  }

  function getURL(path) {
    if (!raw || !raw.runtime || typeof raw.runtime.getURL !== "function") {
      return path;
    }
    return raw.runtime.getURL(path);
  }

  global.BoldLeadExtensionAPI = {
    raw,
    storageGet,
    storageSet,
    tabsQuery,
    tabsUpdate,
    sendMessage,
    runtimeSendMessage,
    getURL
  };
})(globalThis);
