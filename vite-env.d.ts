/**
 * Vite client type declarations.
 *
 * Without this reference, asset imports that Vite resolves specially - e.g.
 * `import worker from 'pdfjs-dist/build/pdf.worker.min.js?url'` in ImageImportModal - have no type
 * and `npx tsc --noEmit` reports "Cannot find module ...?url".
 */
/// <reference types="vite/client" />
