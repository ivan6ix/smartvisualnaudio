import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const authContext = readFileSync(new URL("../src/context/AuthContext.jsx", import.meta.url), "utf8");
const loginBody = authContext.slice(authContext.indexOf("async function login"), authContext.indexOf("async function register"));

assert.ok(loginBody.includes("queryClient.clear();"), "Login must clear in-memory query cache before authenticating.");
assert.ok(loginBody.includes("window.setTimeout"), "Persisted query-cache cleanup must stay off the login critical path.");
assert.ok(!/queryClient\.clear\(\);\s*queryPersister\.removeClient\(\);\s*if \(hasSupabaseConfig\)/.test(loginBody), "Login must not synchronously remove the persisted query cache before signInWithPassword.");
