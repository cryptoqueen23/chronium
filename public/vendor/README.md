# Vendored libraries

`public/` is served as plain static assets with no build step. These are the
official pre-built browser bundles for the document adapters in
`public/ingest/adapters.js`, committed as static files and lazy-loaded via
dynamic `import()` only when a matching file type is actually encountered.

Installed as devDependencies (source of truth for version/license), copied in manually:

```bash
npm install --save-dev fflate pdfjs-dist mammoth xlsx

cp node_modules/fflate/esm/browser.js        public/vendor/fflate/fflate.mjs
cp node_modules/pdfjs-dist/build/pdf.min.mjs        public/vendor/pdfjs/pdf.mjs
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/vendor/pdfjs/pdf.worker.mjs
cp node_modules/mammoth/mammoth.browser.js   public/vendor/mammoth/mammoth.browser.js
cp node_modules/xlsx/xlsx.mjs                public/vendor/xlsx/xlsx.mjs
```

To upgrade a library: bump it in `package.json` (`npm install --save-dev <pkg>@latest`),
re-run the matching `cp` line above, and re-test the relevant adapter.

| Library | Used by | Format | License |
|---|---|---|---|
| fflate | `ingestZip` (streaming unzip) | ESM | MIT |
| pdfjs-dist | `PdfAdapter` | ESM (+ separate worker script) | Apache-2.0 |
| mammoth | `DocxAdapter` | UMD (assigns `window.mammoth`; loaded via `import()` for its side effect, not for exports) | BSD-2-Clause |
| xlsx (SheetJS) | `XlsxAdapter` | ESM | Apache-2.0 |
