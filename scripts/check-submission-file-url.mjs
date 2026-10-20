import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const migrationName = "20261020190000_restore_submission_file_url.sql";
const migration = readFileSync(`supabase/migrations/${migrationName}`, "utf8");

// The restored submit function keeps its security settings and grants.
assert.match(migration, /create or replace function public\.submit_exam_attempt\(p_exam_id uuid, p_answers jsonb, p_violations jsonb default '\[\]'::jsonb\)\s+returns uuid\s+language plpgsql\s+security definer\s+set search_path = public/, "submit_exam_attempt must stay security definer with a fixed search_path.");
assert.match(migration, /revoke all on function public\.submit_exam_attempt\(uuid, jsonb, jsonb\) from public, anon;/, "PUBLIC and anon must not execute submit_exam_attempt.");
assert.match(migration, /grant execute on function public\.submit_exam_attempt\(uuid, jsonb, jsonb\) to authenticated;/, "Authenticated users must keep execute access.");

// file_url comes from a validated upload path, not the grader result.
assert.doesNotMatch(migration, /nullif\(result->>'fileUrl'/, "grade_exam_answer never returns fileUrl.");
assert.match(migration, /submitted_path := case when q\.question_type = 'File Upload' and jsonb_typeof\(answer_value\) = 'object' then nullif\(answer_value->>'path', ''\) end;/, "Only File Upload object answers may supply a path.");
assert.match(migration, /starts_with\(submitted_path, auth\.uid\(\)::text \|\| '\/' \|\| e\.id::text \|\| '\/' \|\| q\.id::text \|\| '\/'\)/, "The path must be in the student's own exam/question folder.");
assert.match(migration, /exists \(select 1 from storage\.objects o where o\.bucket_id = 'exam-submissions' and o\.name = submitted_path\)/, "The path must name an uploaded exam-submissions object.");
assert.match(migration, /coalesce\(\(result->>'manual'\)::boolean, false\),\s+submitted_path\s+\);/, "file_url must be inserted from the validated path.");

// Backfill applies the same checks and only fills missing values.
assert.match(migration, /update public\.exam_attempt_answers aa\s+set file_url = aa\.answer->>'path'/, "Existing answers must be backfilled.");
assert.match(migration, /and nullif\(aa\.file_url, ''\) is null/, "Backfill must not overwrite existing file_url values.");
assert.match(migration, /starts_with\(aa\.answer->>'path', a\.student_id::text \|\| '\/' \|\| a\.exam_id::text \|\| '\/' \|\| q\.id::text \|\| '\/'\)/, "Backfill must use the attempt's student/exam/question folder.");
assert.match(migration, /and exists \(select 1 from storage\.objects o where o\.bucket_id = 'exam-submissions' and o\.name = aa\.answer->>'path'\);/, "Backfill must require the storage object.");

// No later migration replaces submit_exam_attempt again.
const later = readdirSync("supabase/migrations").filter((name) => name > migrationName && /create or replace function public\.submit_exam_attempt\(/.test(readFileSync(`supabase/migrations/${name}`, "utf8")));
assert.deepEqual(later, [], "A later migration redefines submit_exam_attempt; carry the file_url fix forward.");

// Rollback fixture covers access and spoofed paths.
const fixture = readFileSync("supabase/local/submission-file-url-tests.sql", "utf8");
assert.match(fixture, /^set client_min_messages = warning;\s+begin;/, "Fixture must run inside a transaction.");
assert.match(fixture, /rollback;\s*$/, "Fixture must roll back.");
for (const test of ["10 valid own upload records file_url", "11 another student''s path is not recorded", "20 owning professor can read the submitted file", "22 other professor cannot read the file", "31 reopened resubmit records restored path", "40 backfill restores only the valid path"]) {
  assert.ok(fixture.includes(`'${test}'`), `Fixture must include "${test}".`);
}

// The Scores page still opens files from file_url or the answer path.
const scores = readFileSync("src/pages/professor/ProfessorScores.jsx", "utf8");
assert.match(scores, /const path = answer\?\.file_url \|\| \(value && typeof value === "object" \? value\.path : ""\);/, "Open File must resolve the stored path.");
