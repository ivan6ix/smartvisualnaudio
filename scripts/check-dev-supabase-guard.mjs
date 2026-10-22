/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getDevSupabaseUrlError, isLocalSupabaseUrl } from "../src/lib/supabaseUrl.js";

const hosted = "https://abcdefghijklmnop.supabase.co";

assert.equal(isLocalSupabaseUrl("http://127.0.0.1:56621"), true);
assert.equal(isLocalSupabaseUrl("http://localhost:54321/"), true);
assert.equal(isLocalSupabaseUrl("http://[::1]:54321"), true);
assert.equal(isLocalSupabaseUrl(hosted), false);
assert.equal(isLocalSupabaseUrl("http://127.0.0.1.evil.example"), false);

// Dev + hosted URL is refused unless explicitly allowed; production builds and local URLs are unaffected.
assert.match(getDevSupabaseUrlError({ dev: true, url: hosted }), /hosted Supabase/);
assert.equal(getDevSupabaseUrlError({ dev: true, url: hosted, allowHosted: "true" }), "");
assert.equal(getDevSupabaseUrlError({ dev: false, url: hosted }), "");
assert.equal(getDevSupabaseUrlError({ dev: true, url: "http://127.0.0.1:56621" }), "");

const client = readFileSync("src/lib/supabase.js", "utf8");
assert.ok(client.indexOf("if (devUrlError) throw new Error(devUrlError);") < client.indexOf("createClient(url"), "The guard must run before the client is created.");

console.log("dev supabase guard ok");
