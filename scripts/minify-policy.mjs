/**
 * Files that must not go through esbuild's identifier minification.
 *
 * Two extension-side paths serialize JavaScript source and execute it in a page:
 *
 *   - `chrome.scripting.executeScript({ func })` uses `func.toString()`.
 *   - `toInjectableSource()` uses `input.toString()` for function inputs.
 *
 * Minifying those files can rename identifiers that the serialized function
 * expects to find in its original closure. Keeping these files byte-stable makes
 * the injection contract explicit and prevents future edits from silently
 * breaking a serialized function.
 *
 * Paths are relative to the staged extension root and always use `/`.
 */
export const MINIFY_EXCLUDED_FILES = new Set([
  'src/injectable.js',
  'src/tools/inject-script.js',
  'src/tools/base.js',
  'src/tools/click.js',
  'src/tools/fill.js',
  'src/tools/keyboard.js',
  'src/tools/extract-data.js',
  'src/tools/set-files.js',
  'src/tools/upload-file.js',
  'src/tools/wait-elements.js',
  'src/tools/navigate.js',
  'src/tools/mouse-scroll.js',
  'src/tools/set-video-to-page.js',
  'src/tools/download-video-from-url.js',
]);

/** Normalize Windows separators before checking the package path. */
export function normalizePackagePath(relativePath) {
  return String(relativePath).replace(/\\/g, '/');
}

/** Whether this staged JavaScript file should be minified. */
export function shouldMinifyFile(relativePath) {
  return !MINIFY_EXCLUDED_FILES.has(normalizePackagePath(relativePath));
}
