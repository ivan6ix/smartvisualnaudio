import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const file = readdirSync("supabase/migrations").find((name) => name.endsWith("_admin_course_permanent_delete.sql"));
assert.ok(file, "admin course permanent delete migration must exist");
const sql = readFileSync(`supabase/migrations/${file}`, "utf8");

assert.match(sql, /admin_permanently_delete_course\(p_course_id uuid\)/);
assert.match(sql, /security definer/i);
assert.match(sql, /set search_path = public/i);
assert.match(sql, /auth\.uid\(\)/);
assert.match(sql, /caller\.role <> 'Admin'/);
assert.match(sql, /caller\.status <> 'Active'/);
assert.match(sql, /for update/);
assert.match(sql, /not coalesce\(course_row\.archived, false\)/);
assert.match(sql, /delete from public\.exam_start_sessions/);
assert.match(sql, /delete from public\.violations/);
assert.match(sql, /delete from public\.notifications[\s\S]*entity_type[\s\S]*entity_id/);
assert.match(sql, /course\.permanently_deleted/);
assert.match(sql, /jsonb_build_object\('bucket'/);
assert.doesNotMatch(sql, /alter table[\s\S]+on delete cascade/i);
assert.doesNotMatch(sql, /delete from public\.profiles/i);
assert.doesNotMatch(sql, /delete from public\.programs/i);
assert.doesNotMatch(sql, /profile-pictures/);
assert.match(sql, /revoke all on function public\.admin_permanently_delete_course\(uuid\) from public, anon/i);
assert.match(sql, /grant execute on function public\.admin_permanently_delete_course\(uuid\) to authenticated/i);
