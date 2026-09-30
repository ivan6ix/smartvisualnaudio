import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("supabase/functions/admin-delete-course/index.ts", "utf8");

assert.match(source, /admin_permanently_delete_course/);
assert.match(source, /Authorization/);
assert.match(source, /userClient\.auth\.getUser/);
assert.match(source, /global: \{ headers: \{ Authorization: authHeader \} \}/);
assert.match(source, /serviceRoleKey/);
assert.match(source, /ALLOWED_BUCKETS/);
assert.match(source, /course-modules/);
assert.match(source, /course-permits/);
assert.match(source, /exam-submissions/);
assert.match(source, /proctor-snapshots/);
assert.match(source, /audio-violations/);
assert.match(source, /profile-pictures/);
assert.match(source, /normalizeStorageReference/);
assert.match(source, /storage_cleanup_complete/);
assert.match(source, /failed_storage_count/);
assert.doesNotMatch(source, /storage\.from\(body/i);
assert.doesNotMatch(source, /remove\(\[body/i);
