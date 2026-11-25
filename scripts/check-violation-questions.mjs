/* global console */
// Helpers that tie a violation to the question it happened on, and scope violations to one attempt.
import assert from "node:assert/strict";
import fs from "node:fs";
import * as violationQuestions from "../src/lib/violationQuestions.js";

const { formatViolationQuestion, professorQuestionNumbers, violationNotice, violationsForAttempt } = violationQuestions;
// Missing until the helper exists; the adjustment checks below then fail instead of the whole file failing to load.
const validateAnswerAdjustment = violationQuestions.validateAnswerAdjustment ?? (() => ({ error: "validateAnswerAdjustment is not exported" }));

const numbers = professorQuestionNumbers([{ id: "q3", sort_order: 3 }, { id: "q1", sort_order: 1 }, { id: "qn", sort_order: null }, { id: "q2", sort_order: 2 }]);
assert.deepEqual([...numbers], [["q1", 1], ["q2", 2], ["q3", 3], ["qn", 4]]);
assert.equal(formatViolationQuestion("Loud audio detected", 5), "Loud audio detected · Q5");
assert.equal(formatViolationQuestion("Loud audio detected", null), "Loud audio detected");
assert.equal(violationNotice("Loud audio detected", 2), "Loud audio detected on question 2. It is recorded for your professor's review.");
assert.equal(violationNotice("Loud audio detected", null), "Loud audio detected. It is recorded for your professor's review.");
// A label that already ends a sentence does not get a second period.
assert.equal(violationNotice("Loud audio detected.", 2), "Loud audio detected on question 2. It is recorded for your professor's review.");
assert.equal(violationNotice("Loud audio detected.", null), "Loud audio detected. It is recorded for your professor's review.");
assert.equal(violationNotice("Tab switched! ", 1), "Tab switched on question 1. It is recorded for your professor's review.");
assert.equal(violationNotice("Audio evidence recorded for the professor.", null), "Audio evidence recorded for the professor. It is recorded for your professor's review.");
const v = (id, at) => ({ id, exam_id: "e", student_id: "s", created_at: at });
const all = [v("old", "2026-01-01T09:00:00Z"), v("first-session", "2026-01-02T09:00:00Z"), v("after-reopen", "2026-01-03T09:00:00Z"), v("later", "2026-01-05T09:00:00Z")];
const first = { id: "a1", exam_id: "e", student_id: "s", started_at: "2026-01-01T08:00:00Z", submitted_at: "2026-01-01T10:00:00Z" };
const reopened = { id: "a2", exam_id: "e", student_id: "s", started_at: "2026-01-02T08:00:00Z", submitted_at: "2026-01-03T10:00:00Z" };
const third = { id: "a3", exam_id: "e", student_id: "s", started_at: "2026-01-05T08:00:00Z", submitted_at: "2026-01-05T10:00:00Z" };
assert.deepEqual(violationsForAttempt(all, reopened, [first, reopened, third]).map((x) => x.id), ["first-session", "after-reopen"]);
assert.deepEqual(violationsForAttempt(all, first, [first, reopened, third]).map((x) => x.id), ["old"]);
assert.deepEqual(violationsForAttempt(all, third, [first, reopened, third]).map((x) => x.id), ["later"]);
// violations.created_at is the student's clock and submitted_at the server's, so a fast student clock stamps the
// last violations after the submission. With no later attempt they still belong to this one.
const clockAhead = [v("before", "2026-01-03T09:00:00Z"), v("clock-ahead", "2026-01-03T10:02:00Z")];
assert.deepEqual(violationsForAttempt(clockAhead, reopened, [first, reopened]).map((x) => x.id), ["before", "clock-ahead"]);
// With a later attempt, they end where the next attempt starts (exclusive): from its start on they are the next one's.
const nextAttempt = { id: "a4", exam_id: "e", student_id: "s", started_at: "2026-01-03T10:05:00Z", submitted_at: "2026-01-03T11:00:00Z" };
const aroundNext = [...clockAhead, v("at-next-start", "2026-01-03T10:05:00Z"), v("in-next", "2026-01-03T10:30:00Z")];
assert.deepEqual(violationsForAttempt(aroundNext, reopened, [first, reopened, nextAttempt]).map((x) => x.id), ["before", "clock-ahead"]);
assert.deepEqual(violationsForAttempt(aroundNext, nextAttempt, [first, reopened, nextAttempt]).map((x) => x.id), ["at-next-start", "in-next"], "A violation between the submission and the next start is listed once, under the earlier attempt.");
// An attempt without started_at still starts after the previous submission.
assert.deepEqual(violationsForAttempt(aroundNext, { ...nextAttempt, started_at: null }, [first, reopened, nextAttempt]).map((x) => x.id), ["clock-ahead", "at-next-start", "in-next"]);
// A later attempt without started_at ends this one at its submitted_at; other exams' and students' attempts never do.
const nextNoStart = { ...nextAttempt, started_at: null };
const otherExam = { id: "x1", exam_id: "other", student_id: "s", started_at: "2026-01-03T10:01:00Z", submitted_at: "2026-01-03T10:03:00Z" };
const otherStudent = { id: "x2", exam_id: "e", student_id: "t", started_at: "2026-01-03T10:01:00Z", submitted_at: "2026-01-03T10:03:00Z" };
assert.deepEqual(violationsForAttempt(aroundNext, reopened, [first, reopened, nextNoStart, otherExam, otherStudent]).map((x) => x.id), ["before", "clock-ahead", "at-next-start", "in-next"]);

const page = fs.readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
assert.match(page, /violationNotice\(/, "Each violation shows the shared notice.");
assert.match(page, /Violations recorded for your professor/, "The violation counter states they are for review.");
assert.doesNotMatch(page, /Maximum violation limit|Auto-submit after/, "No violation-limit copy remains.");

// Every violation records the question it happened on; professors can adjust an answer with a note.
const sql = fs.readFileSync("supabase/migrations/20261125120000_violation_questions_and_answer_adjustment.sql", "utf8");
assert.match(sql, /add column if not exists question_id uuid references public\.exam_questions\(id\) on delete set null/);
assert.match(sql, /question_number integer check \(question_number is null or question_number > 0\)/);
assert.match(sql, /grading_note text\s+check \(grading_note is null or char_length\(grading_note\) <= 300\)/);
assert.match(sql, /function public\.adjust_exam_attempt_answer\(p_answer_id uuid, p_earned_points numeric, p_note text\)/);
assert.match(sql, /role = 'Professor'[\s\S]*?status = 'Active'/);
assert.match(sql, /professor_id is distinct from auth\.uid\(\) and exam_row\.created_by is distinct from auth\.uid\(\)/);
assert.match(sql, /char_length\(clean_note\) not between 1 and 300|clean_note = ''|length\(clean_note\) = 0/);
assert.match(sql, /grading_note = clean_note/); assert.match(sql, /recalculate_exam_attempt_score\(/);
assert.match(sql, /grant execute on function public\.adjust_exam_attempt_answer\(uuid, numeric, text\) to authenticated/);
assert.match(sql, /revoke all on function public\.adjust_exam_attempt_answer\(uuid, numeric, text\) from public/);
const take = fs.readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
assert.match(take, /async function persistViolation[\s\S]*?const question = getViolationQuestion\(\);[\s\S]*?await /, "The question is captured before the first await.");
assert.match(take, /question_id: question\?\.question_id \?\? null,\s*question_number: question\?\.question_number \?\? null/);
assert.match(take, /professorQuestionNumbers\(/);
assert.match(take, /getQuestionContext: getViolationQuestion/);
const audio = fs.readFileSync("src/services/audioViolationService.js", "utf8");
assert.match(audio, /question_id: questionContext\?\.question_id \?\? null/);
// Run the real audio upload against a fake database: every insert variant carries the question, and a database
// without the question columns still records the violation.
const audioUpload = (failures) => {
  const inserts = [];
  const supabase = { storage: { from: () => ({ upload: async () => ({ error: null }) }) }, from: () => {
    let payload = null;
    const chain = { insert(value) { payload = value; inserts.push(value); return chain; }, update() { return chain; }, eq() { return chain; }, select() { return chain; },
      single() { return chain; }, then(resolve) { return Promise.resolve(payload ? failures(payload) : { error: null }).then(resolve); } };
    return chain;
  } };
  const window = { console: { error() {}, warn() {} } };
  const upload = new Function("supabase", "window", audio.replace(/^import .*;\r?\n/gm, "").replace(/export async function/, "async function") + "\nreturn uploadAudioViolation;")(supabase, window);
  return { inserts, run: (questionContext) => upload({ audioBlob: null, audioLevel: 60, exam: { id: "e" }, studentId: "s", triggeredAt: "2026-01-01T00:00:00Z", questionContext }) };
};
const typeRejected = audioUpload((payload) => (payload?.violation_type === "AUDIO_DETECTED" ? { error: { message: "invalid input value for enum" } } : { data: { id: "v1" }, error: null }));
await typeRejected.run({ question_id: "q2", question_number: 4, screenNumber: 1 });
assert.equal(typeRejected.inserts.length, 3, "Falls through to the fallback violation type.");
for (const insert of typeRejected.inserts) assert.deepEqual([insert.question_id, insert.question_number], ["q2", 4], "Every variant carries the question.");
const oldDatabase = audioUpload((payload) => ("question_id" in payload ? { error: { message: "Could not find the 'question_id' column of 'violations'" } } : { data: { id: "v2" }, error: null }));
const recorded = await oldDatabase.run({ question_id: "q2", question_number: 4, screenNumber: 1 });
assert.equal(recorded.violationId, "v2"); assert.equal(oldDatabase.inserts.at(-1).violation_type, "AUDIO_DETECTED"); assert.equal(oldDatabase.inserts.at(-1).description !== undefined, true);
const noQuestion = audioUpload(() => ({ data: { id: "v3" }, error: null }));
await noQuestion.run(undefined);
assert.deepEqual([noQuestion.inserts[0].question_id, noQuestion.inserts[0].question_number], [null, null]);

// Ongoing Exams reads violations from get_professor_ongoing_exams: it is redefined here with the question number,
// and stays the latest definition otherwise (same security, grants and latest-attempt selection).
const ongoing = sql.slice(sql.indexOf("create or replace function public.get_professor_ongoing_exams()"));
assert.ok(ongoing.length < sql.length, "The migration redefines get_professor_ongoing_exams.");
assert.match(ongoing, /'question_number', v\.question_number,\s*'created_at', v\.created_at/);
assert.match(ongoing, /security definer\s+set search_path = public/);
assert.match(ongoing, /latest_attempts as \(/, "The redefinition keeps the latest-attempt selection.");
assert.match(ongoing, /revoke all on function public\.get_professor_ongoing_exams\(\) from public, anon;\s+grant execute on function public\.get_professor_ongoing_exams\(\) to authenticated;/);
const originalOngoing = fs.readFileSync("supabase/migrations/20260929125004_fix_latest_attempt_uuid_selection.sql", "utf8").replace(/\r\n/g, "\n");
const bodyOf = (text) => text.slice(text.indexOf("create or replace function public.get_professor_ongoing_exams()"), text.indexOf("grant execute on function public.get_professor_ongoing_exams()"));
assert.equal(bodyOf(ongoing.replace("        'question_number', v.question_number,\n", "")), bodyOf(originalOngoing), "Apart from the question number key, the function is the latest definition.");

// Professor review, student note, and "· Q5" on every violation list.
const scores = fs.readFileSync("src/pages/professor/ProfessorScores.jsx", "utf8");
assert.match(scores, /select\("id, exam_id, student_id, violation_type, severity, description, screenshot_url, evidence_url, question_id, question_number, created_at", options\)/);
assert.match(scores, /violationsForAttempt\(/);
assert.match(scores, /supabase\.rpc\("adjust_exam_attempt_answer", \{ p_answer_id: answer\.id, p_earned_points: value, p_note: note \}\)/);
assert.match(fs.readFileSync("src/lib/violationQuestions.js", "utf8"), /A note of 1 to 300 characters is required\./, "The note is required before calling the server (validateAnswerAdjustment, checked below).");
assert.match(scores, /Adjust points/); assert.match(scores, /Not tied to a question/);
assert.match(scores, /grading_note/);
const grades = fs.readFileSync("src/pages/student/StudentGrades.jsx", "utf8");
assert.match(grades, /grading_note/); assert.match(grades, /Adjusted by your professor: /);
for (const file of ["src/pages/professor/ProfessorMonitoring.jsx", "src/pages/professor/ProfessorOngoingExams.jsx", "src/pages/dean/DeanExamIntegrity.jsx"]) {
  const source = fs.readFileSync(file, "utf8");
  assert.match(source, /question_number/, `${file} reads the question number.`);
  assert.match(source, /formatViolationQuestion\(/, `${file} shows "· Q5".`);
}
const audioHook = fs.readFileSync("src/hooks/useLiveAudioMonitoring.js", "utf8");
// The toast is raised by the exam page from the callback payload: it reads the short label, while the long
// message stays on the payload for the violation timeline.
assert.match(audioHook, /label: "Loud audio detected",\s*message: "Audio reached 50%/, "The audio violation carries the short label next to the long message.");
assert.match(page, /violationNotice\(violation\.label \|\| violation\.message \|\| violation\.type/, "The toast prefers the short label.");

// Violations never end an exam, so no user-visible copy under src/ may describe a 5-violation limit.
const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = `${dir}/${entry.name}`;
  if (entry.isDirectory()) return sourceFiles(path);
  return /\.(jsx?|tsx?|html)$/.test(entry.name) ? [path] : [];
});
const limitCopy = /violation limit is 5|(?:5|five)[- ]violation (?:limit|threshold)|limit of (?:5|five) violations|(?:5|five) violations? (?:will|may|automatically) (?:auto-?)?submit|violation threshold is reached/i;
for (const file of sourceFiles("src")) assert.doesNotMatch(fs.readFileSync(file, "utf8"), limitCopy, `${file} still describes a 5-violation limit.`);
const legal = fs.readFileSync("src/pages/Legal.jsx", "utf8");
assert.ok(legal.includes("Recorded violations never end an exam on their own; each one is stored with the question on screen for the professor's review. The interruption limit can still submit an attempt automatically."), "The Terms describe unlimited violations.");
assert.ok(legal.includes("The application stores temporary local progress for recovery and may restore saved answers, scan status and violations. Recorded violations never end"), "The rest of the paragraph stays.");

// Students may update their own violations only to attach evidence: the question they were on is trusted, like
// the type and time. The migration redefines the latest protect_student_violation_updates with the two columns.
const latestProtect = fs.readFileSync("supabase/migrations/20260922103000_security_rls_hardening.sql", "utf8").replace(/\r\n/g, "\n");
const protectOf = (text) => {
  const from = text.indexOf("create or replace function public.protect_student_violation_updates()");
  assert.ok(from >= 0, "The definition is present.");
  return text.slice(from, text.indexOf("$$;", from) + 3);
};
const laterMigrations = fs.readdirSync("supabase/migrations").filter((name) => name > "20260922103000_security_rls_hardening.sql" && name < "20261125120000");
for (const name of laterMigrations) assert.doesNotMatch(fs.readFileSync(`supabase/migrations/${name}`, "utf8"), /function public\.protect_student_violation_updates/, `${name} must not redefine the trigger function.`);
const protect = protectOf(sql.replace(/\r\n/g, "\n"));
assert.match(protect, /or new\.question_id is distinct from old\.question_id\s+or new\.question_number is distinct from old\.question_number/);
assert.equal(
  protect.replace("\n       or new.question_id is distinct from old.question_id\n       or new.question_number is distinct from old.question_number", ""),
  protectOf(latestProtect),
  "Apart from the question columns, the function is the latest definition.",
);
assert.ok(sql.indexOf("create or replace function public.protect_student_violation_updates()") > sql.indexOf("add column if not exists question_id"), "It is redefined after the columns exist.");

// An adjustment needs a points value (an empty box is not 0) and a reason (no prefilled "Question N: ").
assert.deepEqual(validateAnswerAdjustment({ points: "", note: "Loud audio", maxPoints: 5 }), { error: "Enter a score from 0 to 5." });
assert.deepEqual(validateAnswerAdjustment({ points: "   ", note: "Loud audio", maxPoints: 5 }), { error: "Enter a score from 0 to 5." });
assert.deepEqual(validateAnswerAdjustment({ points: null, note: "Loud audio", maxPoints: 2.5 }), { error: "Enter a score from 0 to 2.5." });
assert.deepEqual(validateAnswerAdjustment({ points: "6", note: "Loud audio", maxPoints: 5 }), { error: "Enter a score from 0 to 5." });
assert.deepEqual(validateAnswerAdjustment({ points: "-1", note: "Loud audio", maxPoints: 5 }), { error: "Enter a score from 0 to 5." });
assert.deepEqual(validateAnswerAdjustment({ points: "abc", note: "Loud audio", maxPoints: 5 }), { error: "Enter a score from 0 to 5." });
assert.deepEqual(validateAnswerAdjustment({ points: 0, note: " Cheating – loud audio ", maxPoints: 5 }), { value: 0, note: "Cheating – loud audio" });
assert.deepEqual(validateAnswerAdjustment({ points: "2.5", note: "x", maxPoints: 5 }), { value: 2.5, note: "x" });
assert.deepEqual(validateAnswerAdjustment({ points: "", note: "x", maxPoints: 5, formatMax: (n) => n.toFixed(2) }), { error: "Enter a score from 0 to 5.00." }, "The page keeps its points format.");
assert.deepEqual(validateAnswerAdjustment({ points: "2", note: "   ", maxPoints: 5 }), { error: "A note of 1 to 300 characters is required." });
assert.deepEqual(validateAnswerAdjustment({ points: "2", note: undefined, maxPoints: 5 }), { error: "A note of 1 to 300 characters is required." });
assert.deepEqual(validateAnswerAdjustment({ points: "2", note: "a".repeat(301), maxPoints: 5 }), { error: "A note of 1 to 300 characters is required." });
assert.deepEqual(validateAnswerAdjustment({ points: "2", note: "a".repeat(300), maxPoints: 5 }), { value: 2, note: "a".repeat(300) });
const save = scores.slice(scores.indexOf("async function saveAdjustment"), scores.indexOf("async function reviewReopenRequest"));
assert.match(save, /validateAnswerAdjustment\(\{ points: input\.points \?\? answer\.earned_points, note: input\.note, maxPoints, formatMax: formatPoints \}\)/, "The page validates with the shared helper.");
assert.ok(save.indexOf("validateAnswerAdjustment(") < save.indexOf('supabase.rpc("adjust_exam_attempt_answer"'), "Validation runs before the RPC.");
assert.match(save, /if \(checked\.error\) \{\s*toast\.error\(checked\.error\);\s*return;\s*\}/, "An invalid adjustment stops before the RPC.");
assert.doesNotMatch(scores, /defaultAdjustNote|defaultNote|`Question \$\{number\}: `/, "The note is not prefilled.");
assert.match(scores, /placeholder=\{`Question \$\{questionNumber\}: reason, e\.g\. cheating – loud audio`\}/);
assert.match(scores, /value=\{input\.note \?\? ""\}/);

console.log("Violation question checks passed.");
