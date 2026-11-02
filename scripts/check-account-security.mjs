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

console.log("Account security checks passed.");
