/* global URL */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  ALL_FILTER,
  classifyOngoingStudent,
  filterOngoingExams,
  formatUpdatedAgo,
  getOngoingFilterOptions,
  ONGOING_RELOAD_DEBOUNCE_MS,
  ONGOING_SAFETY_REFRESH_MS,
  getOngoingExamPhase,
  getNextOngoingTransitionDelay,
  paginateOngoingRows,
  sortOngoingRows,
  summarizeOngoingExams,
} from "../src/lib/ongoingExams.js";

const now = new Date("2026-09-28T10:00:00Z").getTime();

const baseStudent = { studentId: "student-a", name: "Ana Cruz", attempts: [], start: null, answeredCount: 0, questionCount: 4, violationCount: 0 };

assert.equal(getOngoingExamPhase({ id: "exam-active", status: "Published", exam_settings: { startsAt: "2026-09-28T09:00:00Z", deadline: "2026-09-28T11:00:00Z" } }, new Set(), now), "active");
assert.equal(getOngoingExamPhase({ id: "exam-upcoming", status: "Published", exam_settings: { startsAt: "2026-09-28T11:00:00Z", deadline: "2026-09-28T12:00:00Z" } }, new Set(), now), "upcoming");
assert.equal(getOngoingExamPhase({ id: "exam-finished", status: "Published", exam_settings: { startsAt: "2026-09-28T08:00:00Z", deadline: "2026-09-28T09:00:00Z" } }, new Set(), now), "finished");
assert.equal(getOngoingExamPhase({ id: "exam-draft", status: "Draft", exam_settings: { startsAt: "2026-09-28T09:00:00Z", deadline: "2026-09-28T11:00:00Z" } }, new Set(), now), "hidden");

assert.equal(classifyOngoingStudent(baseStudent).status, "Not Started");
assert.equal(classifyOngoingStudent({ ...baseStudent, start: { started_at: "2026-09-28T09:55:00Z", interruption_count: 0 } }).status, "In Progress");
assert.equal(classifyOngoingStudent({ ...baseStudent, start: { started_at: "2026-09-28T09:55:00Z", interruption_count: 4, interruption_limit: 3 } }).status, "Interrupted");
assert.equal(classifyOngoingStudent({ ...baseStudent, attempts: [{ attemptNumber: 1, status: "Submitted", submitted_at: "2026-09-28T09:58:00Z" }] }).status, "Submitted");
assert.equal(classifyOngoingStudent({ ...baseStudent, attempts: [{ attemptNumber: 1, status: "Submitted", submission_reason: "violation_limit" }] }).status, "Auto-Submitted");
assert.equal(classifyOngoingStudent({ ...baseStudent, attempts: [{ attemptNumber: 1, status: "Submitted" }], start: { started_at: "2026-09-28T09:59:00Z" } }).status, "In Progress");

const exams = [
  {
    id: "exam-a",
    phase: "active",
    students: [
      { studentId: "student-a", status: "Not Started", violationCount: 0 },
      { studentId: "student-b", status: "Interrupted", violationCount: 2 },
      { studentId: "student-c", status: "Submitted", violationCount: 3 },
      { studentId: "student-c", status: "Submitted", violationCount: 3 },
    ],
  },
];

assert.deepEqual(summarizeOngoingExams(exams), {
  activeExams: 1,
  assigned: 3,
  notStarted: 1,
  inProgress: 1,
  submitted: 1,
  violations: 2,
  totalViolations: 5,
});
// One student with five violations shows 5 in the exam list and the summary, not 1.
assert.equal(summarizeOngoingExams([{ id: "exam-b", phase: "active", students: [{ studentId: "s1", status: "Auto-Submitted", violationCount: 5 }] }]).totalViolations, 5);
const ongoingPage = readFileSync("src/pages/professor/ProfessorOngoingExams.jsx", "utf8");
assert.match(ongoingPage, /<strong role="cell">\{counters\.totalViolations\}<\/strong>/, "The exam list shows the total number of violations.");
assert.match(ongoingPage, /\["Violations", summary\.totalViolations, FiAlertTriangle/, "The summary card shows the total number of violations.");
assert.match(ongoingPage, /\{counters\.violations\} With Violations/, "The detail view still counts students with violations.");

const rows = [
  { studentName: "Cara", status: "Submitted", attemptNumber: 2, answeredCount: 3, questionCount: 4, violationCount: 1 },
  { studentName: "Ana", status: "Not Started", attemptNumber: 0, answeredCount: 0, questionCount: 4, violationCount: 0 },
  { studentName: "Ben", status: "In Progress", attemptNumber: 1, answeredCount: 2, questionCount: 4, violationCount: 3 },
];

assert.deepEqual(sortOngoingRows(rows, "student", "asc").map((row) => row.studentName), ["Ana", "Ben", "Cara"]);
assert.deepEqual(sortOngoingRows(rows, "violations", "desc").map((row) => row.studentName), ["Ben", "Cara", "Ana"]);
assert.deepEqual(paginateOngoingRows(Array.from({ length: 21 }, (_, index) => ({ id: index })), 2, 20).map((row) => row.id), [20]);

assert.equal(getNextOngoingTransitionDelay([
  { startsAt: "2026-09-28T10:00:05Z", deadline: "2026-09-28T10:00:10Z" },
  { startsAt: "2026-09-28T11:00:00Z", deadline: "2026-09-28T12:00:00Z" },
], now), 5000);

// Course and section filters: sections follow the chosen course, and All keeps everything.
{
  const exams = [
    { id: "1", courseCode: "MCB101", section: "B" },
    { id: "2", courseCode: "MCA101", section: "A" },
    { id: "3", courseCode: "MCA101", section: "C" },
    { id: "4", courseName: "No Code Course", section: "" },
  ];
  assert.deepEqual(getOngoingFilterOptions(exams), { courses: ["MCA101", "MCB101", "No Code Course"], sections: ["A", "B", "C"] });
  assert.deepEqual(getOngoingFilterOptions(exams, "MCA101").sections, ["A", "C"]);
  assert.equal(filterOngoingExams(exams).length, 4);
  assert.deepEqual(filterOngoingExams(exams, { course: "MCA101" }).map((exam) => exam.id), ["2", "3"]);
  assert.deepEqual(filterOngoingExams(exams, { course: "MCA101", section: "C" }).map((exam) => exam.id), ["3"]);
  assert.deepEqual(filterOngoingExams(exams, { course: ALL_FILTER, section: "B" }).map((exam) => exam.id), ["1"]);
  assert.deepEqual(filterOngoingExams(exams, { course: "No Code Course" }).map((exam) => exam.id), ["4"]);
}

// The "Updated" label tells the professor how fresh the numbers are.
assert.equal(formatUpdatedAgo(null, now), "Not updated yet");
assert.equal(formatUpdatedAgo(now - 3000, now), "Updated just now");
assert.equal(formatUpdatedAgo(now - 45000, now), "Updated 45 sec ago");
assert.equal(formatUpdatedAgo(now - 3 * 60000, now), "Updated 3 min ago");
assert.equal(formatUpdatedAgo(now - 2 * 3600000, now), "Updated 2 hr ago");
assert.ok(ONGOING_RELOAD_DEBOUNCE_MS > 0 && ONGOING_RELOAD_DEBOUNCE_MS <= 1000, "Live changes reload within a second.");
assert.equal(ONGOING_SAFETY_REFRESH_MS, 30000);

// Starts and submissions reach the professor live: both tables are in the realtime publication, and the
// professor may read start sessions of their own exams (realtime only sends rows the listener can read).
{
  const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
  const sql = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()
    .map((name) => readFileSync(new URL(name, migrationsDir), "utf8")).join("\n");
  assert.match(sql, /alter publication supabase_realtime add table public\.exam_start_sessions;/);
  assert.match(sql, /alter publication supabase_realtime add table public\.exam_attempts;/);
  assert.match(sql, /create policy exam_start_sessions_professor_read on public\.exam_start_sessions\s+for select to authenticated\s+using \(\s+exists \([\s\S]*?exams\.professor_id = auth\.uid\(\) or exams\.created_by = auth\.uid\(\)/);
}

// The page reloads once per burst of live changes, has a Refresh button, and reloads quietly every 30 seconds.
{
  const page = readFileSync(new URL("../src/pages/professor/ProfessorOngoingExams.jsx", import.meta.url), "utf8");
  assert.match(page, /table: "exam_start_sessions" \}, scheduleReload\)/);
  assert.match(page, /table: "exam_attempts" \}, scheduleReload\)/);
  assert.match(page, /table: "violations" \}, scheduleReload\)/);
  assert.doesNotMatch(page, /table: "exam_attempt_answers"/, "Answer rows are not published; submissions arrive through exam_attempts.");
  assert.match(page, /window\.setTimeout\(\(\) => void loadOngoingRef\.current\?\.\(\), ONGOING_RELOAD_DEBOUNCE_MS\)/);
  assert.match(page, /aria-label="Refresh ongoing exams"/);
  assert.match(page, /formatUpdatedAgo\(updatedAt, clock\)/);
  assert.match(page, /if \(visible\(\)\) void loadOngoingRef\.current\?\.\(\);\s+\}, ONGOING_SAFETY_REFRESH_MS\)/);
  assert.match(page, /if \(initial \|\| manual\) toast\.error/, "Background reloads never show error toasts.");
}
