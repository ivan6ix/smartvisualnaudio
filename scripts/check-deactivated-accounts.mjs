/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEACTIVATED_ACCOUNT_MESSAGE, isDeactivatedStatus, signInErrorMessage } from "../src/lib/accountStatus.js";

// Only the Deactivated status blocks an account.
assert.equal(isDeactivatedStatus("Deactivated"), true);
assert.equal(isDeactivatedStatus(" deactivated "), true);
for (const status of ["Active", "Pending", "", null, undefined]) assert.equal(isDeactivatedStatus(status), false);

// A banned (deactivated) account gets the deactivation message; other sign-in errors keep their own.
assert.equal(signInErrorMessage({ message: "User is banned", code: "user_banned" }), DEACTIVATED_ACCOUNT_MESSAGE);
assert.equal(signInErrorMessage({ message: "User is banned" }), DEACTIVATED_ACCOUNT_MESSAGE);
assert.equal(signInErrorMessage({ message: "Invalid login credentials" }), "Invalid login credentials");
assert.equal(signInErrorMessage({}), "Sign-in failed. Try again.");

// Deactivating an account bans it in Supabase Auth; reactivating lifts the ban.
const accountFunction = readFileSync("supabase/functions/create-account/index.ts", "utf8");
assert.match(accountFunction, /const DEACTIVATED_BAN_DURATION = "876000h";/);
assert.match(accountFunction, /action === "update-status"[\s\S]*?updateUserById\(userId, \{\s*user_metadata: metadata,\s*ban_duration: status === "Deactivated" \? DEACTIVATED_BAN_DURATION : "none",\s*\}\)/,
  "The status update must set or lift the ban together with the metadata.");

// The app signs out a deactivated account at sign-in, when a saved session loads, and on later auth events.
const auth = readFileSync("src/context/AuthContext.jsx", "utf8");
assert.match(auth, /if \(error\) throw new Error\(signInErrorMessage\(error\)\);/);
assert.match(auth, /const nextUser = await mapAuthUser\(data\.user\);\s+if \(isDeactivatedStatus\(nextUser\?\.status\)\) \{\s+intentionalLogout\.current = true;\s+await supabase\.auth\.signOut\(\);\s+throw new Error\(DEACTIVATED_ACCOUNT_MESSAGE\);/,
  "Sign-in must refuse a deactivated profile before the session is kept.");
assert.match(auth, /async function endDeactivatedSession\(\) \{[\s\S]*?toast\.error\(DEACTIVATED_ACCOUNT_MESSAGE\);[\s\S]*?expireSession\(\);[\s\S]*?supabase\.auth\.signOut\(\)/);
assert.equal((auth.match(/if \(isDeactivatedStatus\(nextUser\?\.status\)\) \{ await endDeactivatedSession\(\); return; \}/g) || []).length, 2,
  "Saved sessions and auth events must both end a deactivated account's session.");

console.log("Deactivated account checks passed");
