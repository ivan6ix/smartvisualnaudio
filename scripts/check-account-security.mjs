/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Only active Admins manage accounts: a Dean must not reset or deactivate anyone (including Admins).
const accountFunction = readFileSync("supabase/functions/create-account/index.ts", "utf8");
assert.match(accountFunction, /const adminRoles = new Set\(\["Admin"\]\);/, "Only Admins may call the account function.");
assert.match(accountFunction, /\.select\("role, status"\)/, "The caller's status must be read.");
assert.match(accountFunction, /caller\.status !== "Active"/, "Deactivated Admins must be refused.");

// Students no longer read every profile; staff, classmates, their professors and message partners only.
const migration = readFileSync("supabase/migrations/20261103120000_restrict_profile_reads.sql", "utf8");
assert.match(migration, /drop policy if exists "profiles_read_authenticated" on public\.profiles;/);
assert.doesNotMatch(migration, /create policy "profiles_read_authenticated"/);
assert.match(migration, /create policy "profiles_read_related" on public\.profiles\s+for select to authenticated\s+using \(\s+id = \(select auth\.uid\(\)\)\s+or role <> 'Student'\s+or \(select public\.can_read_all_profiles\(\)\)\s+or public\.can_read_student_profile\(id\)\s+\);/);
assert.match(migration, /function public\.can_read_all_profiles\(\)[\s\S]*?security definer[\s\S]*?role in \('Admin', 'Dean', 'Cluster Professor'\)\s+and status = 'Active'/);
for (const source of ["course_enrollments", "exam_attempts", "violations", "exam_student_assignments", "messages"]) {
  assert.match(migration, new RegExp(`function public\\.can_read_student_profile[\\s\\S]*public\\.${source}`), `Student profiles must stay readable through ${source}.`);
}
assert.match(migration, /revoke all on function public\.can_read_student_profile\(uuid\) from public, anon, authenticated;/);

// Manage Accounts lists every account, not the newest 250.
const accounts = readFileSync("src/pages/Accounts.jsx", "utf8");
assert.doesNotMatch(accounts, /\.limit\(\d+\)/, "Manage Accounts must not cap the account list.");
assert.match(accounts, /fetchAllRows\(\(options\) => supabase\s+\.from\("profiles"\)/);

// Accounts with an Admin-set password (created or reset) must set their own at sign-in.
assert.match(accountFunction, /full_name: fullName,[\s\S]*?must_change_password: true,/, "New accounts are marked to change their password.");
assert.match(accountFunction, /action === "reset-password"[\s\S]*?must_change_password: true[\s\S]*?updateUserById\(userId, \{ password, user_metadata: metadata \}\)/, "Resets mark the account in the same update.");

const { mustChangePassword, updateOwnPassword, validateNewPassword } = await import("../src/lib/settingsSecurity.js");
assert.equal(mustChangePassword({ user_metadata: { must_change_password: true } }), true);
assert.equal(mustChangePassword({ user_metadata: { must_change_password: false } }), false);
assert.equal(mustChangePassword({ user_metadata: {} }), false);
assert.equal(mustChangePassword(null), false);
{
  let payload = null;
  await updateOwnPassword({ auth: { updateUser: async (body) => { payload = body; return { error: null }; } } }, "my-own-secret");
  assert.deepEqual(payload, { password: "my-own-secret", data: { must_change_password: false } }, "Setting a password clears the mark in the same request.");
}
assert.equal(validateNewPassword({ newPassword: "abc", confirmPassword: "abc" }), "Use at least 6 characters for the new password.");
assert.equal(validateNewPassword({ newPassword: "abcdef", confirmPassword: "abcdeg" }), "Passwords do not match.");
assert.equal(validateNewPassword({ newPassword: "abcdef", confirmPassword: "abcdef" }), "");

for (const file of ["src/pages/ResetPassword.jsx", "src/pages/ForgotPassword.jsx"]) {
  const source = readFileSync(file, "utf8");
  assert.doesNotMatch(source, /auth\.updateUser\(/, `${file} must clear the mark through updateOwnPassword.`);
  assert.match(source, /updateOwnPassword\(supabase, values\.password\)/);
}
const auth = readFileSync("src/context/AuthContext.jsx", "utf8");
assert.match(auth, /mustChangePassword: mustChangePassword\(authUser\)/);
const app = readFileSync("src/App.jsx", "utf8");
assert.match(app, /if \(mustChangePassword && !PASSWORD_CHANGE_OPEN_PATHS\.has\(pathname\)\) return <Navigate to="\/change-password" replace \/>;/, "Every other page redirects until the password is changed.");
assert.match(app, /<Route path="\/change-password" element=\{<ChangePassword \/>\} \/>/);
const changePage = readFileSync("src/pages/ChangePassword.jsx", "utf8");
assert.match(changePage, /if \(!user\.mustChangePassword\) return <Navigate/, "The page sends users without the mark home.");
assert.match(changePage, /updateOwnPassword\(supabase, values\.newPassword\)/);
assert.match(changePage, /same_password/, "Reusing the temporary password gets a clear message.");

console.log("Account security checks passed.");
