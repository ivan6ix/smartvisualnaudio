/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CHUNK_RELOAD_KEY, CHUNK_RELOAD_WINDOW_MS, isChunkLoadError, reloadForNewVersion } from "../src/lib/chunkReload.js";

// Old page files after a release, in each browser's wording.
for (const message of [
  "Failed to fetch dynamically imported module: https://x.app/assets/ProfessorLayout-abc.js",
  "Importing a module script failed.",
  "error loading dynamically imported module",
  "Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of \"text/html\".",
  "Unable to preload CSS for /assets/index-abc.css",
]) assert.ok(isChunkLoadError(new Error(message)), message);
assert.ok(isChunkLoadError({ name: "ChunkLoadError", message: "" }));
assert.ok(!isChunkLoadError(new Error("Cannot read properties of undefined (reading 'map')")));
assert.ok(!isChunkLoadError(null));

// It reloads once, then not again within the window (so a real outage cannot loop), then again later.
const store = new Map();
const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
let reloads = 0;
const location = { reload: () => { reloads += 1; } };
assert.equal(reloadForNewVersion({ storage, location, now: 1_000_000 }), true);
assert.equal(store.get(CHUNK_RELOAD_KEY), "1000000");
assert.equal(reloadForNewVersion({ storage, location, now: 1_000_000 + CHUNK_RELOAD_WINDOW_MS - 1 }), false);
assert.equal(reloadForNewVersion({ storage, location, now: 1_000_000 + CHUNK_RELOAD_WINDOW_MS }), true);
assert.equal(reloads, 2);
// Blocked storage still reloads instead of leaving a blank page.
const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
assert.equal(reloadForNewVersion({ storage: blocked, location, now: 10_000_000 }), true);

// Wiring: Vite's preload errors reload, the whole app sits inside the error screen, and missing page files are
// real 404s instead of the app's HTML.
const main = readFileSync("src/main.jsx", "utf8");
assert.match(main, /addEventListener\("vite:preloadError"[\s\S]*reloadForNewVersion\(\)\) event\.preventDefault\(\)/);
assert.match(main, /<AppErrorBoundary>\s*<BrowserRouter>[\s\S]*<\/BrowserRouter>\s*<\/AppErrorBoundary>/);
const boundary = readFileSync("src/components/AppErrorBoundary.jsx", "utf8");
assert.match(boundary, /static getDerivedStateFromError/);
assert.match(boundary, /isChunkLoadError\(error\) && reloadForNewVersion\(\)/);
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const rewrite = vercel.rewrites.find((item) => item.destination === "/index.html");
assert.equal(rewrite.source, "/((?!assets/).*)", "Page files under /assets are never answered with index.html.");
const appRoute = new RegExp(`^${rewrite.source}$`);
assert.ok(appRoute.test("/professor") && appRoute.test("/professor/monitoring") && !appRoute.test("/assets/old.js"));

console.log("Chunk reload checks passed.");
