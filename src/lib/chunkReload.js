// After a new version goes live, a tab that was opened earlier still asks for the old page files, which no longer
// exist. Loading the page again picks up the new version. It reloads at most once per short window, so a real
// outage shows an error screen instead of reloading forever.
export const CHUNK_RELOAD_KEY = "smartvisualnaudio.chunk-reload-at";
export const CHUNK_RELOAD_WINDOW_MS = 30_000;

const CHUNK_ERROR_PATTERN = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed|Loading CSS chunk|Unable to preload CSS|is not a valid JavaScript MIME type|Expected a JavaScript(-or-Wasm)? module script/i;

export function isChunkLoadError(error) {
  if (!error) return false;
  if (error.name === "ChunkLoadError") return true;
  return CHUNK_ERROR_PATTERN.test(String(error.message || error));
}

// Returns true when it started a reload, false when it already reloaded a moment ago.
export function reloadForNewVersion({ storage = globalThis.sessionStorage, location = globalThis.location, now = Date.now() } = {}) {
  let last = 0;
  try {
    last = Number(storage?.getItem(CHUNK_RELOAD_KEY) || 0);
  } catch {
    last = 0;
  }
  if (now - last < CHUNK_RELOAD_WINDOW_MS) return false;
  try {
    storage?.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    // Without storage it may reload again next time, which is still better than a blank page.
  }
  location?.reload();
  return true;
}
