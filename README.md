# reader

`reader` is a Safari Web Extension that automatically turns readable text into bionic-style text: the leading characters of each word are emphasized while the rest of the word stays visually normal.

It runs automatically on page load, follows dynamic page updates, and also rewrites embedded PDF text streams in memory so direct PDFs render with bionic word starts inside Safari.

## What It Does

- Runs on all allowed URLs as soon as Safari permits the content script.
- Bolds configurable leading characters for every readable word.
- Watches dynamic DOM changes and open shadow roots.
- Handles normal page text, SVG text, iframes Safari exposes, and direct PDF URLs.
- Rewrites PDF text drawing operations in memory, then lets Safari render the resulting PDF.
- Leaves metadata alone, including document titles, head tags, links, and meta tags.
- Provides a small popup for configuration and the global enable toggle.
- Includes a one-click page-session disable that reloads the current tab without attaching the reader until the next explicit reload.

## Limits

Some surfaces are browser-owned or not real selectable text. `reader` cannot safely rewrite those.

- Safari internal pages are off limits.
- Closed shadow roots are off limits.
- Canvas text and image-only text are off limits.
- Scanned PDFs need OCR and do not contain text streams to rewrite.
- Password fields, inputs, textareas, and editable regions are intentionally skipped.

## Install For Development

```sh
npm install
npm run vendor:pdfjs
npm run package:extension
```

Then generate the Safari wrapper:

```sh
xcrun safari-web-extension-converter dist/extension \
  --project-location SafariProject \
  --app-name "reader" \
  --bundle-identifier dev.emiliocramer.reader \
  --macos-only \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force
```

Open `SafariProject/reader/reader.xcodeproj` in Xcode, run the `reader` app, then enable the extension in Safari:

```text
Safari Settings -> Extensions -> reader
```

Grant website access for the sites you want transformed.

## Rebuild After Changes

```sh
npm run package:extension

xcrun safari-web-extension-converter dist/extension \
  --project-location SafariProject \
  --app-name "reader" \
  --bundle-identifier dev.emiliocramer.reader \
  --macos-only \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force
```

For the cleanest reload during testing, quit Safari fully, relaunch the `reader` app from Xcode or the built app, then reopen Safari.

## Test

```sh
npm test
npm run smoke:pdfs
```

`npm test` covers the DOM engine, config handling, manifest resources, PDF routing, in-place PDF mounting, and PDF byte rewriting.

`npm run smoke:pdfs` runs live PDF checks against several public PDFs, including direct `.pdf` URLs, URLs without a `.pdf` suffix, CID-heavy PDFs, and form-heavy PDFs.

## Project Layout

```text
background/   Extension background worker.
content/      Page content script and page CSS.
icons/        Extension icons.
pdf/          Packaged PDF viewer fallback.
popup/        Configuration popup.
scripts/      Vendoring, packaging, and smoke-test scripts.
shared/       Shared browser, config, DOM, PDF, and routing logic.
test/         Node test suite.
vendor/       Vendored pdf.js and pdf-lib browser assets.
```

Generated output lives in `dist/` and `SafariProject/`.

## Environment

No environment variables are required. Keep local-only values in `.env` if you ever add them; `.env` files are ignored by git.
