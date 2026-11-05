/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/professor/ProfessorExams.jsx", "utf8");
const sql = readFileSync("supabase/migrations/20261105120000_share_exam_to_course.sql", "utf8");

// Sharing to a course is one database call. The browser no longer inserts a Published exam and then its questions,
// which the question guard refuses and which left an empty exam behind on every click.
assert.match(page, /rpc\("share_exam_to_course"/);
assert.doesNotMatch(page, /from\("exams"\)\s*\.insert\(/, "The page must not create shared exams itself.");

// Quick repeated clicks only run once, and every Share button waits while one share is running.
assert.match(page, /sharingRef\.current\) return;/);
assert.match(page, /disabled=\{Boolean\(sharingTargetId\) \|\| row\.shared\}/);
assert.match(page, /row\.shared \? "Shared" : "Share"/);

// The database copies the exam as Unpublished, copies the questions, then gives the copy the source's status.
const insertAt = sql.indexOf("insert into public.exams");
const questionsAt = sql.indexOf("insert into public.exam_questions");
const publishAt = sql.indexOf("set status = 'Published'");
assert.ok(insertAt > 0 && insertAt < questionsAt && questionsAt < publishAt, "Questions are copied before the copy is published.");
assert.match(sql, /'entire_course', question_total, 'Unpublished'/);
assert.match(sql, /lower\(source\.status\) in \('published', 'active'\)/);

// One copy per course: copies remember the original, and repeated calls wait on a lock and then see the first copy.
assert.match(sql, /jsonb_build_object\('sharedFromExamId', root_id::text\)/);
assert.match(sql, /pg_advisory_xact_lock/);
assert.match(sql, /This exam is already shared to %/);
assert.match(sql, /professor_id = auth\.uid\(\)\s+and not coalesce\(archived, false\)/, "Only the professor's own active courses.");
assert.match(sql, /revoke all on function public\.share_exam_to_course\(uuid, uuid\) from public, anon/);

// Sharing to the same student again does not send another notification.
assert.match(sql, /if not already_shared then\s+insert into public\.notifications/);

console.log("exam sharing checks passed");
