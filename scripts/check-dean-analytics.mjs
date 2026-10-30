/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PERIOD_ORDER, buildDeanAnalytics, normalizePeriod } from "../src/lib/deanAnalytics.js";
import { latestSubmittedAttempts } from "../src/lib/integrityRisk.js";

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 0.0005, `${message}: ${actual} vs ${expected}`);

assert.deepEqual(PERIOD_ORDER, ["Prelim", "Midterm", "Semi-Final", "Final"]);
assert.equal(normalizePeriod(" midterm "), "Midterm");
assert.equal(normalizePeriod("Semi Final"), "Semi-Final");
assert.equal(normalizePeriod("Quiz 1"), "Other");
assert.equal(normalizePeriod(""), "Other");

// The latest submitted attempt per exam and student counts; reopened and unsubmitted ones do not.
assert.deepEqual(latestSubmittedAttempts([
  { id: "old", exam_id: "e", student_id: "s", status: "Reopened", submitted_at: "2026-10-01T08:00:00Z" },
  { id: "new", exam_id: "e", student_id: "s", status: "Submitted", submitted_at: "2026-10-02T08:00:00Z" },
  { id: "earlier", exam_id: "e", student_id: "t", status: "Submitted", submitted_at: "2026-10-01T08:00:00Z" },
  { id: "later", exam_id: "e", student_id: "t", status: "Submitted", submitted_at: "2026-10-03T08:00:00Z" },
  { id: "open", exam_id: "e", student_id: "u", status: "In Progress", submitted_at: null },
]).map((attempt) => attempt.id).sort(), ["later", "new"]);

const courses = [
  { id: "c1", course_code: "CPR2", section: "4A", course_name: "Computer Programming 2", semester: "1st Semester", academic_year: "2026-2027", program_id: "p1" },
  { id: "c2", course_code: "CPR2", section: "4B", course_name: "Computer Programming 2", semester: "1st Semester", academic_year: "2026-2027", program_id: "p1" },
  { id: "c3", course_code: "ITE101", section: "1C", course_name: "Introduction to Computing", semester: "2nd Semester", academic_year: "2026-2027", program_id: "p2" },
];
const exams = [
  { id: "e1", course_id: "c1", status: "Published", description: "Prelim" },
  { id: "e2", course_id: "c1", status: "Published", description: "Midterm" },
  { id: "e3", course_id: "c2", status: "Published", description: "Prelim" },
  { id: "e4", course_id: "c2", status: "Published", description: "Midterm", passing_score: 70 },
  { id: "e5", course_id: "c3", status: "Published", description: "Final" },
  { id: "e6", course_id: "c1", status: "Draft", description: "Final" },
  { id: "e7", course_id: "c2", status: "Published", description: "Quiz 1" },
];
let sequence = 0;
const attempt = (examId, studentId, score, status = "Submitted") => ({
  id: `a${(sequence += 1)}`,
  exam_id: examId,
  student_id: studentId,
  score,
  status,
  submitted_at: `2026-10-${String(10 + sequence).padStart(2, "0")}T08:00:00Z`,
});
const attempts = [
  attempt("e1", "s1", 20, "Reopened"),
  attempt("e1", "s1", 80), attempt("e1", "s2", 60), attempt("e1", "s3", 40),
  attempt("e2", "s1", 90), attempt("e2", "s2", 70),
  attempt("e3", "s4", 50), attempt("e3", "s5", 30),
  attempt("e4", "s4", 70), attempt("e4", "s5", 65),
  attempt("e5", "s6", 100),
  attempt("e6", "s1", 99),
  attempt("e7", "s4", 55),
];
const violations = [
  { exam_id: "e3", student_id: "s4", violation_type: "PHONE_DETECTED", created_at: "2026-10-17T08:10:00Z" },
  { exam_id: "e3", student_id: "s4", violation_type: "PHONE_DETECTED", created_at: "2026-10-17T08:11:00Z" },
  { exam_id: "e3", student_id: "s4", violation_type: "MULTIPLE_FACE", created_at: "2026-10-17T08:12:00Z" },
  { exam_id: "e1", student_id: "s1", violation_type: "NO_FACE", created_at: "2026-10-12T08:05:00Z" },
  { exam_id: "e6", student_id: "s1", violation_type: "PHONE_DETECTED", created_at: "2026-10-22T08:05:00Z" },
];

const result = buildDeanAnalytics({ exams, courses, attempts, violations });

// Totals: 6 published exams, 11 final attempts, average 710 / 11, 6 passed (exam passing score or 60).
assert.equal(result.kpis.exams, 6);
assert.equal(result.kpis.attempts, 11);
close(result.kpis.averageScore, 710 / 11, "average score");
close(result.kpis.passRate, 6 / 11, "pass rate");
assert.equal(result.kpis.highRisk, 1, "Only the attempt with two phones and an extra face is high risk.");
close(result.kpis.highRiskRate, 1 / 11, "high-risk rate");
assert.equal(result.kpis.alerts, 4, "Alerts on draft exams are excluded.");

// Trends follow the academic period order; exams without a standard period are grouped as Other.
assert.deepEqual(result.periods.map((row) => row.period), ["Prelim", "Midterm", "Final", "Other"]);
const prelim = result.periods[0];
assert.deepEqual([prelim.exams, prelim.attempts], [2, 5]);
close(prelim.averageScore, 52, "prelim average");
close(prelim.passRate, 0.4, "prelim pass rate");
close(prelim.alertsPer100, 80, "prelim alerts per 100 attempts");
close(prelim.highRiskRate, 0.2, "prelim high-risk rate");
const midterm = result.periods[1];
close(midterm.averageScore, 73.75, "midterm average");
close(midterm.passRate, 0.75, "midterm pass rate uses each exam's passing score");
assert.equal(midterm.alertsPer100, 0);

// Sections.
assert.deepEqual(result.sections.map((row) => row.label), ["CPR2 - 4A", "CPR2 - 4B", "ITE101 - 1C"]);
const [sectionA, sectionB, sectionC] = result.sections;
assert.deepEqual([sectionA.exams, sectionA.attempts], [2, 5]);
close(sectionA.averageScore, 68, "4A average");
close(sectionA.passRate, 0.8, "4A pass rate");
close(sectionA.alertsPerAttempt, 0.2, "4A alerts per attempt");
assert.deepEqual([sectionB.exams, sectionB.attempts], [3, 5]);
close(sectionB.averageScore, 54, "4B average");
close(sectionB.passRate, 0.2, "4B pass rate");
close(sectionB.highRiskRate, 0.2, "4B high-risk rate");
assert.deepEqual(sectionB.flags, { lowPass: true, highRisk: true });
assert.deepEqual(sectionA.flags, { lowPass: false, highRisk: false });
assert.equal(sectionC.courseName, "Introduction to Computing");

// Recommendations name the section and the reason.
const titles = result.recommendations.map((item) => item.title);
assert.ok(titles.includes("Schedule a review session for CPR2 - 4B"));
assert.ok(titles.includes("Require environment scans in CPR2 - 4B"));
assert.ok(!titles.some((title) => /fell/i.test(title)), "Scores rose across periods, so no drop warning.");
assert.ok(result.recommendations.every((item) => item.tag && item.detail));

// A drop between the last two periods is reported.
const drop = buildDeanAnalytics({
  exams: [{ id: "x1", course_id: "c1", status: "Published", description: "Prelim" }, { id: "x2", course_id: "c1", status: "Published", description: "Midterm" }],
  courses,
  attempts: [attempt("x1", "s1", 80), attempt("x1", "s2", 90), attempt("x2", "s1", 60), attempt("x2", "s2", 70)],
  violations: [],
});
assert.ok(drop.recommendations.some((item) => item.title === "Average score fell from Prelim to Midterm"));
assert.ok(drop.recommendations.some((item) => item.title === "Scores in CPR2 - 4A fell from Prelim to Midterm"), "A drop within one section is reported for that section.");
assert.deepEqual(drop.sections[0].trend, { from: "Prelim", to: "Midterm", fromScore: 85, toScore: 65 });
assert.equal(result.sections[0].trend, null, "Rising sections have no drop trend.");

// Filters and their options come from the courses.
assert.deepEqual(result.options.semesters, ["1st Semester", "2nd Semester"]);
assert.deepEqual(result.options.academicYears, ["2026-2027"]);
assert.deepEqual(result.options.programIds, ["p1", "p2"]);
const second = buildDeanAnalytics({ exams, courses, attempts, violations, filters: { semester: "2nd Semester" } });
assert.deepEqual([second.kpis.exams, second.kpis.attempts], [1, 1]);
assert.deepEqual(second.sections.map((row) => row.label), ["ITE101 - 1C"]);
assert.deepEqual(buildDeanAnalytics({ exams, courses, attempts, violations, filters: { programId: "p1" } }).sections.map((row) => row.label), ["CPR2 - 4A", "CPR2 - 4B"]);
const empty = buildDeanAnalytics({ exams: [], courses: [], attempts: [], violations: [] });
assert.equal(empty.kpis.averageScore, null);
assert.deepEqual(empty.periods, []);

// Wiring: the dean gets an Analytics page in the menu, reachable at /dean/analytics.
const app = readFileSync("src/App.jsx", "utf8");
assert.match(app, /<Route path="analytics" element=\{<DeanAnalytics \/>\} \/>/);
const layout = readFileSync("src/pages/dean/DeanLayout.jsx", "utf8");
assert.match(layout, /label: "Analytics", to: "\/dean\/analytics"/);
const page = readFileSync("src/pages/dean/DeanAnalytics.jsx", "utf8");
assert.match(page, /buildDeanAnalytics\(/);
assert.match(page, /from\("exam_attempts"\)/);
assert.match(page, /Trends by period/);
assert.match(page, /Section comparison/);
const integrity = readFileSync("src/pages/dean/DeanExamIntegrity.jsx", "utf8");
assert.match(integrity, /latestSubmittedAttempts/);
assert.doesNotMatch(integrity, /function latestSubmittedAttempts/, "The dean pages share one helper.");

console.log("Dean analytics checks passed.");
