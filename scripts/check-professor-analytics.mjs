/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ALL_FILTERS, VIOLATION_DATE_RANGES, countByViolationType, filterViolations, getRangeStart, violationFilterOptions } from "../src/lib/violationFilters.js";

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
assert.match(integrity, /isProfessor \? filterViolations\(violations, filters\)/);
assert.match(integrity, /<h2>Violation Analytics<\/h2>/);
assert.match(dashboard, /filterViolations\(violations, \{/, "The dean dashboard uses the same filters.");
assert.match(readFileSync("src/styles.css", "utf8"), /:is\(\.dean-shell, \.dean-integrity-page\) \.dean-integrity-link \{/, "Evidence links look the same for both roles.");

console.log("Professor analytics checks passed.");
