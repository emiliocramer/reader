(function startBoldLeadPopup(global) {
  "use strict";

  const API = global.BoldLeadExtensionAPI;
  const Config = global.BoldLeadReaderConfig;

  if (!API || !Config) {
    return;
  }

  const controls = {
    enabled: document.getElementById("enabled"),
    fixationRatio: document.getElementById("fixationRatio"),
    fixationValue: document.getElementById("fixationValue"),
    minFixation: document.getElementById("minFixation"),
    maxFixation: document.getElementById("maxFixation"),
    fontWeight: document.getElementById("fontWeight"),
    weightValue: document.getElementById("weightValue"),
    transformCode: document.getElementById("transformCode"),
    transformEditable: document.getElementById("transformEditable"),
    pdfRedirectEnabled: document.getElementById("pdfRedirectEnabled"),
    refreshPage: document.getElementById("refreshPage"),
    status: document.getElementById("status")
  };

  let saveTimer = null;

  function render(settings) {
    const normalized = Config.normalizeSettings(settings);
    controls.enabled.checked = normalized.enabled;
    controls.fixationRatio.value = String(Math.round(normalized.fixationRatio * 100));
    controls.fixationValue.value = controls.fixationRatio.value + "%";
    controls.minFixation.value = String(normalized.minFixation);
    controls.maxFixation.value = String(normalized.maxFixation);
    controls.fontWeight.value = String(normalized.fontWeight);
    controls.weightValue.value = String(normalized.fontWeight);
    controls.transformCode.checked = normalized.transformCode;
    controls.transformEditable.checked = !normalized.skipEditable;
    controls.pdfRedirectEnabled.checked = normalized.pdfRedirectEnabled;
    controls.status.textContent = normalized.enabled ? "Enabled automatically" : "Disabled";
  }

  function readControls() {
    return Config.normalizeSettings({
      enabled: controls.enabled.checked,
      fixationRatio: Number(controls.fixationRatio.value) / 100,
      minFixation: Number(controls.minFixation.value),
      maxFixation: Number(controls.maxFixation.value),
      fontWeight: Number(controls.fontWeight.value),
      transformCode: controls.transformCode.checked,
      skipEditable: !controls.transformEditable.checked,
      pdfRedirectEnabled: controls.pdfRedirectEnabled.checked
    });
  }

  function save() {
    const settings = readControls();
    render(settings);

    if (saveTimer) {
      global.clearTimeout(saveTimer);
    }

    saveTimer = global.setTimeout(() => {
      saveTimer = null;
      API.storageSet(readControls()).catch(() => {});
    }, 50);
  }

  function forceRefresh() {
    API.tabsQuery({ active: true, currentWindow: true })
      .then((tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || typeof tab.id !== "number") {
          return undefined;
        }
        return API.sendMessage(tab.id, { type: "boldlead-force-refresh" });
      })
      .catch(() => {});
  }

  const inputs = [
    controls.enabled,
    controls.fixationRatio,
    controls.minFixation,
    controls.maxFixation,
    controls.fontWeight,
    controls.transformCode,
    controls.transformEditable,
    controls.pdfRedirectEnabled
  ];

  for (const input of inputs) {
    input.addEventListener("input", save);
    input.addEventListener("change", save);
  }

  controls.refreshPage.addEventListener("click", forceRefresh);

  API.storageGet(Config.DEFAULT_SETTINGS)
    .then((settings) => {
      render(settings);
    })
    .catch(() => {
      render(Config.DEFAULT_SETTINGS);
    });
})(globalThis);
