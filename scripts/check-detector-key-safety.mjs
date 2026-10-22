/* global console */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(jsx?|mjs)$/.test(name) ? [path] : [];
  });
}

// The browser bundle must never reference a Roboflow key or call Roboflow directly.
for (const file of sourceFiles("src")) {
  const source = readFileSync(file, "utf8");
  assert.ok(!/VITE_ROBOFLOW_API_KEY|api_key/.test(source), `${file} must not read a Roboflow key in the browser.`);
  assert.ok(!/detect\.roboflow\.com|serverless\.roboflow\.com/.test(source), `${file} must reach Roboflow only through a server.`);
}

// When the authenticated Edge Function is configured, every scan angle must pass through it.
const page = readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
assert.match(page, /const SERVER_SCAN_ENDPOINT = hasSupabaseConfig \? getUsableScanEndpoint\(import\.meta\.env\.VITE_ENV_SCAN_ENDPOINT\) : "";/);
assert.match(page, /requiredDetectors: SERVER_SCAN_ENDPOINT \? \[detectScanFramesWithScanEndpoint\] : \[\]/, "The server detector must be required, not a fallback.");

// The Edge Function keeps detector keys server-side, requires auth, fails closed, and never echoes fetch errors.
const fn = readFileSync("supabase/functions/environment-scan/index.ts", "utf8");
assert.match(fn, /Deno\.env\.get\("ROBOFLOW_API_KEY"\)/);
assert.match(fn, /auth\.getUser\(\)[\s\S]*Unauthorized request\./);
assert.match(fn, /throw new DetectorUnavailableError\(\);/);
assert.match(fn, /catch \{\s*\/\/ Fetch errors include the request URL[\s\S]*?throw new Error\(`Detector request failed/);

console.log("detector key safety ok");
