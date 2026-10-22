/* global console */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20261022120000_restrict_password_reset_notification.sql", "utf8");
assert.match(migration, /revoke all on function public\.request_admin_password_reset_notification\(text\) from public, anon, authenticated;/);
const statements = migration.replace(/--.*$/gm, "");
assert.doesNotMatch(statements, /\b(insert|update|delete|truncate|drop|alter)\b/i, "The fix must change privileges only.");

// Nothing in the app may depend on calling it as a signed-out or signed-in user.
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
for (const file of [...files("src"), ...files("supabase/functions")]) {
  assert.ok(!readFileSync(file, "utf8").includes("request_admin_password_reset_notification"), `${file} must not call the restricted RPC.`);
}

console.log("password reset notification grants ok");
