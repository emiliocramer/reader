# reader

Safari Web Extension that automatically applies bionic-style leading-letter bolding on every supported page load.

## What Is Included

- Default enabled global content script.
- `<all_urls>` host permission.
- `document_start` injection.
- `all_frames` injection for frames the browser allows extensions to access.
- Mutation observers for dynamic page updates.
- Open shadow-root traversal and observation.
- SVG text labels through SVG `<tspan>` wrappers.
- Config popup with enable toggle, fixation width, min/max bold letters, font weight, code-text handling, and PDF handling.
- In-place PDF handling: direct PDF URLs keep their original address while `reader` mounts PDF handling over the browser PDF surface.
- Native PDF rewrite path: `reader` rewrites PDF text-show operators so the resulting PDF itself paints word starts in synthetic bold, then Safari renders that PDF.
- Text fallback: damaged PDFs or PDFs that cannot be safely rewritten fall back to embedded text extraction with vendored pdf.js.

## Hard Browser Limits

The extension cannot mutate browser-owned/internal pages, closed shadow roots, canvas-rendered text, images, or password/input values because those are not exposed as normal page text. For PDFs, the extension keeps the original PDF URL, rewrites embedded PDF text streams in memory, and displays the rewritten PDF in the page. Scanned/image-only PDFs need OCR and will show no embedded text.

## Develop

```sh
npm install
npm run vendor:pdfjs
npm run package:extension
npm test
npm run smoke:pdfs
```

`npm test` covers DOM transformation, dynamic content, open shadow roots, SVG text, editable-region behavior, in-place PDF mounting, PDF URL/header detection, manifest resources, and embedded PDF text extraction.

`npm run smoke:pdfs` performs live network checks against the Palantir PDF, an arXiv PDF URL without a `.pdf` suffix, IRS PDFs including a CID/form-heavy publication, and W3C-generated PDFs.

## Build Safari Wrapper

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

Open `SafariProject/reader/reader.xcodeproj`, run the containing app, then enable the extension in Safari Settings.

## Manual Checks

- Open `fixtures/smoke.html` after granting file-page access.
- Open an ordinary article page.
- Open a page with dynamic content.
- Open a direct `.pdf` URL and confirm the address bar remains on the PDF URL while the bionic PDF reader appears in the page.
# reader
