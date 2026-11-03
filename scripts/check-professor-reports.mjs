/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ALL, EMPTY_FILTERS, buildReport, buildReportContext, filterOptions, formatCell, reportCsv } from "../src/lib/professorReports.js";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const day = (offset) => new Date(NOW + offset * 86400000).toISOString();

// One course taught in two sections, each with its own copy of the same quiz and midterm.
const data = {
  courses: [
    { id: "cA", course_code: "MATH101", course_name: "Algebra", section: "A" },
    { id: "cB", course_code: "MATH101", course_name: "Algebra", section: "B" },
    { id: "cC", course_code: "SCI101", course_name: "Science", section: "A" },
  ],
  exams: [
    { id: "qA", title: "Quiz 1", course_id: "cA", exam_type: "Quiz", description: "Prelim", passing_score: 60, duration: 30, created_at: day(-40) },
    { id: "qB", title: "Quiz 1", course_id: "cB", exam_type: "Quiz", description: "Prelim", passing_score: 60, duration: 30, created_at: day(-40) },
    { id: "mA", title: "Midterm", course_id: "cA", exam_type: "Exam", description: "Midterm", passing_score: 75, duration: 60, created_at: day(-10), exam_settings: { deadline: day(-5) } },
    { id: "mB", title: "Midterm", course_id: "cB", exam_type: "Exam", description: "Midterm", passing_score: 75, duration: 60, created_at: day(-10), exam_settings: { deadline: day(5) } },
    { id: "sA", title: "Lab test", course_id: "cC", exam_type: "Exam", description: "Prelim", created_at: day(-3), assignment_mode: "selected_students" },
  ],
  enrollments: [
    { course_id: "cA", student_id: "s1" },
    { course_id: "cA", student_id: "s2" },
    { course_id: "cB", student_id: "s3" },
    { course_id: "cC", student_id: "s1" },
    { course_id: "cC", student_id: "s3" },
  ],
  assignments: [{ exam_id: "sA", student_id: "s1" }],
  exceptions: [],
  attempts: [
    { id: "a1", exam_id: "qA", student_id: "s1", score: 50, earned_points: 5, max_points: 10, status: "Submitted", started_at: day(-40), submitted_at: day(-40) },
    { id: "a1b", exam_id: "qA", student_id: "s1", score: 90, earned_points: 9, max_points: 10, status: "Submitted", started_at: day(-39), submitted_at: day(-39) },
    { id: "a2", exam_id: "mA", student_id: "s1", score: 80, earned_points: 40, max_points: 50, status: "Submitted", started_at: "2026-10-22T10:00:00Z", submitted_at: "2026-10-22T10:42:00Z" },
    { id: "a3", exam_id: "qA", student_id: "s2", score: 40, earned_points: 4, max_points: 10, status: "Submitted", started_at: day(-40), submitted_at: day(-40) },
    { id: "a4", exam_id: "qB", student_id: "s3", score: 70, earned_points: 7, max_points: 10, status: "Submitted", started_at: day(-40), submitted_at: day(-40) },
    { id: "a5", exam_id: "mB", student_id: "s3", score: null, earned_points: null, max_points: 50, status: "Submitted", started_at: day(-1), submitted_at: day(-1) },
    { id: "a6", exam_id: "sA", student_id: "s1", score: 100, earned_points: 20, max_points: 20, status: "Submitted", started_at: day(-3), submitted_at: day(-3) },
  ],
  pendingAttemptIds: ["a5"],
  starts: [],
  violations: [
    { id: "v1", exam_id: "mA", student_id: "s1", violation_type: "PHONE_DETECTED", severity: "High", created_at: "2026-10-22T10:05:00Z" },
    { id: "v2", exam_id: "mA", student_id: "s1", violation_type: "PHONE_DETECTED", severity: "High", created_at: "2026-10-22T10:06:00Z" },
    { id: "v3", exam_id: "mA", student_id: "s1", violation_type: "MULTIPLE_FACE", severity: "High", created_at: "2026-10-22T10:07:00Z" },
    { id: "v4", exam_id: "qA", student_id: "s2", violation_type: "TAB_SWITCH", severity: "Low", created_at: day(-40) },
    { id: "v5", exam_id: "other", student_id: "s2", violation_type: "TAB_SWITCH", severity: "Low", created_at: day(-1) },
  ],
  students: [
    { id: "s1", full_name: "Ana Cruz", student_number: "2026-001" },
    { id: "s2", full_name: "=HYPERLINK(\"x\")", student_number: "2026-002" },
    { id: "s3", full_name: "Ben Reyes", student_number: "2026-003" },
  ],
};

const context = buildReportContext(data, NOW);
const filters = (changes = {}) => ({ ...EMPTY_FILTERS, ...changes });
const byStudent = (report) => new Map(report.rows.map((row) => [row.studentId, row]));

// Grade sheet: needs a course; sections share columns; best graded attempt counts; missing and pending block a remark.
{
  assert.match(buildReport(context, "grade-sheet", filters()).needs, /Choose a course/);
  const sheet = buildReport(context, "grade-sheet", filters({ course: "MATH101" }));
  assert.deepEqual(sheet.columns.map((column) => column.label), ["Student", "Student number", "Section", "Quiz 1", "Midterm", "Average", "Remarks"], "Same quiz and midterm in two sections share one column each.");
  const rows = byStudent(sheet);
  assert.equal(rows.size, 3);
  const [quiz, midterm] = sheet.columns.slice(3, 5).map((column) => column.key);
  assert.equal(rows.get("s1")[quiz], "90%", "The best graded attempt counts.");
  assert.equal(rows.get("s1").average, "85%");
  assert.equal(rows.get("s1").remark, "Passed", "85% clears the average pass mark of 67.5%.");
  assert.equal(rows.get("s2")[midterm], "Missing", "No attempt after the deadline is missing work.");
  assert.equal(rows.get("s2").remark, "Incomplete");
  assert.equal(rows.get("s3")[midterm], "Needs grading");
  assert.equal(rows.get("s3").section, "MATH101 - B");
  assert.deepEqual(sheet.summary.find((item) => item.label === "Missing work").value, 1);
  const sectionB = buildReport(context, "grade-sheet", filters({ course: "MATH101", section: "B" }));
  assert.deepEqual(sectionB.rows.map((row) => row.studentId), ["s3"]);
  const prelimOnly = buildReport(context, "grade-sheet", filters({ course: "MATH101", period: "Prelim" }));
  assert.deepEqual(prelimOnly.columns.map((column) => column.label).slice(3, -2), ["Quiz 1"]);
  const recent = buildReport(context, "grade-sheet", filters({ course: "MATH101", dateRange: "Last 30 days" }));
  assert.deepEqual(recent.columns.map((column) => column.label).slice(3, -2), ["Midterm"], "Date range follows the exam's start, deadline or creation date.");
  const searched = buildReport(context, "grade-sheet", filters({ course: "MATH101", search: "2026-003" }));
  assert.deepEqual(searched.rows.map((row) => row.studentId), ["s3"]);
}

// Exam results: one exam, everyone who should take it, time taken, alerts and risk.
{
  assert.match(buildReport(context, "exam-results", filters()).needs, /Choose an exam/);
  const results = buildReport(context, "exam-results", filters({ examId: "mA" }));
  const rows = byStudent(results);
  assert.equal(rows.get("s1").points, "40 / 50");
  assert.equal(rows.get("s1").score, "80%");
  assert.equal(rows.get("s1").remark, "Passed");
  assert.equal(rows.get("s1").minutes, "42 min");
  assert.equal(rows.get("s1").alerts, 3);
  assert.equal(rows.get("s1").risk, "High", "Two phones (40) and a second face (20) reach High.");
  assert.equal(rows.get("s2").status, "Missing");
  assert.equal(formatCell(results.columns.find((column) => column.key === "submitted"), rows.get("s2").submitted), "-", "No submission shows a dash, not 1970.");
  assert.equal(results.summary[0].value, "1 of 2");
  assert.deepEqual(buildReport(context, "exam-results", filters({ examId: "mA", status: "Missing" })).rows.map((row) => row.studentId), ["s2"]);
  assert.match(buildReport(context, "exam-results", filters({ course: "SCI101", examId: "mA" })).needs, /Choose an exam/, "An exam outside the chosen course is not shown.");
}

// Integrity: alerts on the professor's exams only, filtered by alert type, severity and alert date.
{
  const report = buildReport(context, "integrity", filters());
  assert.equal(report.rows.length, 4, "Alerts on exams that are not this professor's are left out.");
  assert.equal(report.summary.find((item) => item.label === "Most common").value, "Cellphone detected (2)");
  assert.equal(buildReport(context, "integrity", filters({ alertType: "Tab switch" })).rows.length, 1);
  assert.equal(buildReport(context, "integrity", filters({ severity: "High" })).rows.length, 3);
  assert.equal(buildReport(context, "integrity", filters({ dateRange: "Last 30 days" })).rows.length, 3, "Date range follows when the alert happened.");
}

// Student report: the chosen student's exams across courses, including selected-student exams.
{
  assert.match(buildReport(context, "student", filters({ course: ALL })).needs, /Choose a student/);
  const report = buildReport(context, "student", filters({ course: ALL, studentId: "s1" }));
  assert.deepEqual(report.rows.map((row) => row.exam), ["Quiz 1", "Midterm", "Lab test"]);
  assert.equal(report.summary.find((item) => item.label === "Passed").value, "3 of 3");
  assert.equal(buildReport(context, "student", filters({ course: ALL, studentId: "s3" })).rows.some((row) => row.exam === "Lab test"), false, "Selected-student exams only list their students.");
  const options = filterOptions(context, filters({ course: "SCI101" }));
  assert.deepEqual(options.students.map((student) => student.id), ["s1"], "The student list follows the chosen course's exams.");
}

// Course summary: one row per class.
{
  const report = buildReport(context, "course-summary", filters({ course: ALL }));
  assert.deepEqual(report.rows.map((row) => row.section), ["MATH101 - A", "MATH101 - B", "SCI101 - A"]);
  const sectionA = report.rows[0];
  assert.equal(sectionA.students, 2);
  assert.equal(sectionA.exams, 2);
  assert.equal(sectionA.missing, 1);
  assert.equal(sectionA.alerts, 4);
  assert.equal(sectionA.passRate, "67%", "Two of three graded results pass.");
}

// CSV: header plus every row, quotes and commas escaped, and formula-looking cells made safe.
{
  const csv = reportCsv(buildReport(context, "grade-sheet", filters({ course: "MATH101" })));
  const lines = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "Student,Student number,Section,Quiz 1,Midterm,Average,Remarks");
  assert.ok(lines.some((line) => line.startsWith("\"'=HYPERLINK(\"\"x\"\")\"")), "A name starting with = is written as text, not a formula.");
}

// The page: professor-only route and sidebar item, every table read in full, print and CSV wired.
const page = readFileSync("src/pages/professor/ProfessorReports.jsx", "utf8");
const app = readFileSync("src/App.jsx", "utf8");
const layout = readFileSync("src/pages/professor/ProfessorLayout.jsx", "utf8");
assert.match(app, /<Route path="reports" element=\{<ProfessorReports \/>\} \/>/);
assert.match(layout, /\{ label: "Reports", to: "\/professor\/reports", icon: FiPrinter \}/);
assert.doesNotMatch(page, /\.limit\(\d+\)/, "Reports must read every row.");
assert.match(page, /\.eq\("needs_manual_grading", true\)\.in\("exam_attempts\.exam_id", examIds\)/, "Only answers waiting for grading are loaded.");
assert.match(page, /queryKey: \["professor-reports", user\?\.id\]/, "Cached reports are kept per user.");
assert.match(page, /window\.print\(\)/);
assert.match(page, /downloadCsv\(reportCsv\(report\), reportFileName\(reportType\)\)/);
assert.match(page, /className="professor-report-print"[\s\S]*report\.rows\.map/, "The printout lists every row, not one page.");
const styles = readFileSync("src/styles.css", "utf8");
assert.match(styles, /@media print \{\s+\.professor-app-shell,[\s\S]*\.professor-report-screen \{\s+display: none !important;/);

console.log("Professor reports checks passed.");
