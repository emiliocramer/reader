(function attachBoldLeadReaderConfig(global) {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    fixationRatio: 0.5,
    minFixation: 1,
    maxFixation: 8,
    fontWeight: 700,
    transformCode: true,
    skipEditable: false,
    pdfRedirectEnabled: true
  });

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, number));
  }

  function normalizeSettings(settings) {
    const source = settings || {};
    const minFixation = Math.round(
      clampNumber(source.minFixation, 1, 6, DEFAULT_SETTINGS.minFixation)
    );
    const maxFixation = Math.round(
      clampNumber(source.maxFixation, minFixation, 16, DEFAULT_SETTINGS.maxFixation)
    );

    return {
      enabled: source.enabled !== false,
      fixationRatio: clampNumber(
        source.fixationRatio,
        0.2,
        0.8,
        DEFAULT_SETTINGS.fixationRatio
      ),
      minFixation,
      maxFixation,
      fontWeight: Math.round(
        clampNumber(source.fontWeight, 500, 900, DEFAULT_SETTINGS.fontWeight)
      ),
      transformCode: source.transformCode !== false,
      skipEditable: source.skipEditable !== false,
      pdfRedirectEnabled: source.pdfRedirectEnabled !== false
    };
  }

  global.BoldLeadReaderConfig = {
    DEFAULT_SETTINGS,
    normalizeSettings
  };
})(globalThis);
