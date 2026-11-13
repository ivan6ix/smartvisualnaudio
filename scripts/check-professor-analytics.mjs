/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildDeanAnalytics } from "../src/lib/deanAnalytics.js";
import { ALL_FILTERS, ALL_RECORD_FILTERS, VIOLATION_DATE_RANGES, countByViolationType, filterRecords, filterViolations, getRangeStart, violationFilterOptions } from "../src/lib/violationFilters.js";

// Shared Violation Analytics filters (dean dashboard and exam integrity pages).
const now = new Date("2026-11-02T12:00:00");
const day = 24 * 60 * 60 * 1000;
const row = (overrides) => ({ student: "Ana Reyes", studentNumber: "2026-001", course: "CPR2 - 4A", exam: "Prelim", violationType: "No face detected", severity: "High", description: "Face left the frame", timestamp: now.getTime() - day / 2, ...overrides });
const rows = [
  row({}),
  row({ student: "Ben Cruz", course: "CPR2 - 4B", exam: "Midterm", violationType: "Tab switch attempt", severity: "Medium", timestamp: now.getTime() - 3 * day }),
  row({ student: "Cy Lim", exam: "Midterm", violationType: "Tab switch attempt", severity: "Low", timestamp: now.getTime() - 20 * day }),
  row({ student: "Di Uy", course: "-", exam: "Unknown exam", timestamp: now.getTime() - 60 * day }),
];
assert.deepEqual(VIOLATION_DATE_RANGES, ["All Time", "Today", "Last 7 Days", "Last 30 Days"]);
assert.equal(getRangeStart("All Time", now), 0);
assert.equal(getRangeStart("Today", now), new Date("2026-11-02T00:00:00").getTime());
const names = (filters) => filterViolations(rows, { ...ALL_FILTERS, ...filters }, now).map((item) => item.student);
assert.deepEqual(names({}), ["Ana Reyes", "Ben Cruz", "Cy Lim", "Di Uy"]);
assert.deepEqual(names({ dateRange: "Last 7 Days" }), ["Ana Reyes", "Ben Cruz"]);
assert.deepEqual(names({ dateRange: "Last 30 Days" }), ["Ana Reyes", "Ben Cruz", "Cy Lim"]);
assert.deepEqual(names({ course: "CPR2 - 4A" }), ["Ana Reyes", "Cy Lim"]);
assert.deepEqual(names({ course: "CPR2 - 4A", exam: "Midterm" }), ["Cy Lim"]);
assert.deepEqual(names({ type: "Tab switch attempt", severity: "Medium" }), ["Ben Cruz"]);
assert.deepEqual(names({ search: "  FRAME " }), ["Ana Reyes", "Ben Cruz", "Cy Lim", "Di Uy"], "Search covers the description.");
assert.deepEqual(names({ search: "2026-001 cruz" }), [], "Search matches one phrase, not separate words.");
assert.deepEqual(names({ search: "ben" }), ["Ben Cruz"]);

// Options skip placeholders, and the exam list follows the chosen course.
const options = violationFilterOptions(rows);
assert.deepEqual(options.courses, ["CPR2 - 4A", "CPR2 - 4B"]);
assert.deepEqual(options.exams, ["Prelim", "Midterm"]);
assert.deepEqual(violationFilterOptions(rows, "CPR2 - 4B").exams, ["Midterm"]);
assert.deepEqual(options.severities, ["High", "Medium", "Low"]);
assert.deepEqual(countByViolationType(rows), [{ name: "No face detected", count: 2 }, { name: "Tab switch attempt", count: 2 }]);

// Analytics course and exam filters: everything follows them, except the at-risk prediction, which keeps using
// every exam of the chosen courses because it needs each student's history.
{
  const courses = [
    { id: "c1", course_code: "CPR2", section: "4A", course_name: "Programming", semester: "1st Semester", academic_year: "2026-2027" },
    { id: "c2", course_code: "CPR2", section: "4B", course_name: "Programming", semester: "1st Semester", academic_year: "2026-2027" },
  ];
  const exams = [
    { id: "e1", title: "Prelim Quiz", course_id: "c1", status: "Published", description: "Prelim" },
    { id: "e2", title: "Midterm Exam", course_id: "c1", status: "Published", description: "Midterm" },
    { id: "e3", title: "Semi-Final Exam", course_id: "c1", status: "Published", description: "Semi-Final" },
    { id: "e4", title: "Prelim Quiz", course_id: "c2", status: "Published", description: "Prelim" },
  ];
  const at = (day) => `2026-10-${String(day).padStart(2, "0")}T08:00:00Z`;
  const attempt = (exam, student, score, day) => ({ id: `${exam}${student}`, exam_id: exam, student_id: student, score, status: "Submitted", submitted_at: at(day) });
  const attempts = [attempt("e1", "s1", 72, 1), attempt("e2", "s1", 61, 8), attempt("e3", "s1", 52, 15), attempt("e4", "s2", 90, 2)];
  const all = buildDeanAnalytics({ exams, courses, attempts, violations: [] });
  assert.deepEqual(all.options.courses, [{ id: "c1", label: "CPR2 - 4A" }, { id: "c2", label: "CPR2 - 4B" }]);
  assert.deepEqual(all.options.exams.map((exam) => exam.id), ["e2", "e1", "e4", "e3"], "Exams are listed by title.");
  const course = buildDeanAnalytics({ exams, courses, attempts, violations: [], filters: { courseId: "c1" } });
  assert.deepEqual(course.sections.map((row) => row.id), ["c1"]);
  assert.deepEqual(course.options.exams.map((exam) => exam.id), ["e2", "e1", "e3"], "The exam list follows the chosen course.");
  assert.equal(course.kpis.exams, 3);
  const exam = buildDeanAnalytics({ exams, courses, attempts, violations: [], filters: { courseId: "c1", examId: "e3" } });
  assert.equal(exam.kpis.exams, 1, "Figures follow the exam filter.");
  assert.deepEqual(exam.atRisk.map((row) => row.studentId), ["s1"], "The at-risk prediction still uses the section's other exams.");
  assert.equal(exam.atRisk[0].scores.length, 3);
}

// Wiring: professors get the dean's pages with their own wording; the data is limited by row-level security.
const app = readFileSync("src/App.jsx", "utf8");
const layout = readFileSync("src/pages/professor/ProfessorLayout.jsx", "utf8");
const analytics = readFileSync("src/pages/dean/DeanAnalytics.jsx", "utf8");
const integrity = readFileSync("src/pages/dean/DeanExamIntegrity.jsx", "utf8");
const dashboard = readFileSync("src/pages/dean/DeanDashboard.jsx", "utf8");
assert.match(app, /<Route path="analytics" element=\{<ProfessorAnalytics \/>\} \/>/);
assert.match(app, /<Route path="integrity" element=\{<ProfessorExamIntegrity \/>\} \/>/);
assert.match(layout, /label: "Monitoring"[\s\S]*label: "Analytics", to: "\/professor\/analytics"[\s\S]*label: "Exam Integrity", to: "\/professor\/integrity"/);
assert.match(readFileSync("src/pages/professor/ProfessorAnalytics.jsx", "utf8"), /<DeanAnalytics scope="professor" \/>/);
assert.match(readFileSync("src/pages/professor/ProfessorExamIntegrity.jsx", "utf8"), /<DeanExamIntegrity scope="professor" \/>/);
assert.match(analytics, /queryKey: \[`\$\{scope\}-analytics`, user\?\.id\]/, "Cached results are kept per role and per user.");
assert.match(analytics, /const AT_RISK_PAGE_SIZE = 5;/);
assert.match(analytics, /<ListPagination count=\{atRiskRows\.length\} page=\{atRiskPage\.page\} pageSize=\{AT_RISK_PAGE_SIZE\}/, "Students at risk are shown 5 per page.");
assert.match(analytics, /label="Course"[\s\S]*label="Exam"[\s\S]*Reset Filters/);
assert.match(analytics, /<SearchBox value=\{search\}/);
assert.match(analytics, /label="Risk"[\s\S]*label="Section"[\s\S]*label="Score Trend"/, "Students at risk have their own filters.");
assert.match(integrity, /const filteredViolations = useMemo\(\(\) => filterViolations\(violations, filters\)/, "Violation Analytics keeps its own filters.");
// Integrity Records have their own filters, including evidence.
assert.deepEqual(filterRecords(rows.map((item, index) => ({ ...item, hasEvidence: index === 0 })), { ...ALL_RECORD_FILTERS, evidence: "With Evidence" }, now).length, 1);
assert.deepEqual(filterRecords(rows.map((item, index) => ({ ...item, hasEvidence: index === 0 })), { ...ALL_RECORD_FILTERS, evidence: "No Evidence" }, now).length, rows.length - 1);
assert.equal(filterRecords(rows, ALL_RECORD_FILTERS, now).length, filterViolations(rows, ALL_FILTERS, now).length);
assert.match(integrity, /<h2>Violation Analytics<\/h2>/);
assert.match(dashboard, /filterViolations\(violations, \{/, "The dean dashboard uses the same filters.");
assert.match(readFileSync("src/styles.css", "utf8"), /:is\(\.dean-shell, \.dean-integrity-page\) \.dean-integrity-link \{/, "Evidence links look the same for both roles.");

console.log("Professor analytics checks passed.");
