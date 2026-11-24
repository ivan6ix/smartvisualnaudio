/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { collapseSharedExams } from "../src/lib/sharedExams.js";

// A shared exam (one copy per course) is listed once, naming every course; other exams are untouched.
const exams = [
  { id: "e1", groupId: "g1", course: "CPR2 - 4A", courseMeta: "BSIT • 4th Year • Section 4A", sharedCourses: ["CPR2 - 4A", "FL231 - A"], title: "21st Century Literature" },
  { id: "e2", groupId: "g1", course: "FL231 - A", courseMeta: "BSIT • 4th Year • Section A", sharedCourses: ["CPR2 - 4A", "FL231 - A"], title: "21st Century Literature" },
  { id: "e3", groupId: "", course: "HCI101 - A", courseMeta: "BSIT • 1st Year • Section A", sharedCourses: [], title: "Quiz 1" },
];
const listed = collapseSharedExams(exams);
assert.deepEqual(listed.map((exam) => exam.id), ["e1", "e3"], "Each shared exam appears once, as its newest copy.");
assert.equal(listed[0].course, "CPR2 - 4A, FL231 - A", "The shared row names every course.");
assert.equal(listed[0].courseMeta, "2 courses");
assert.deepEqual(listed[1], exams[2], "An exam in one course is unchanged.");
const list = readFileSync("src/pages/professor/ProfessorExams.jsx", "utf8");
assert.match(list, /collapseSharedExams\(examRows\.map\(\(exam\) => mapExam\(exam, reviewByExam, groupByExam\)\)\)/, "The professor's list collapses shared exams.");
assert.match(list, /exam\.groupId && exam\.sharedCourses\.includes\(filters\.course\)/, "The course filter matches a shared exam by any of its courses.");

// Add Question uses the Save as Draft box: a border and no shadow.
const css = readFileSync("src/styles.css", "utf8");
assert.match(css, /\.professor-add-question,\s*\.professor-save-draft \{\s*border: 1px solid #d8deea;\s*background: var\(--app-surface\);\s*color: var\(--app-text\);\s*box-shadow: none;/);
assert.doesNotMatch(css, /\.professor-add-question \{\s*background: var\(--app-surface\);\s*box-shadow: 0 10px 22px/, "Add Question has no drop shadow.");

// Admin tables keep the Actions cell a real table cell, so row lines are not cut.
assert.match(css, /\.admin-app-shell\[data-role="Admin"\] \.admin-section-page td\.actions \{\s*display: table-cell;\s*min-width: 0;/);
assert.match(css, /\.courses-table-wrap td:not\(\.actions\) \{\s*white-space: normal;\s*overflow-wrap: break-word;/, "Course Records names wrap instead of overlapping.");

// Staff programs: a nullable profiles.program_id, filled for existing Cluster Professors, that users cannot change.
const migration = readFileSync("supabase/migrations/20261121090000_staff_program_assignment.sql", "utf8");
assert.match(migration, /add column if not exists program_id uuid references public\.programs\(id\) on delete set null/);
assert.match(migration, /update public\.profiles p\s+set program_id = c\.program_id\s+from public\.cluster_professors c/);
assert.match(migration, /or new\.program_id is distinct from old\.program_id/, "Users cannot assign themselves a program.");
assert.match(migration, /revoke all on function public\.protect_profile_privileged_fields\(\) from public, anon, authenticated;/);
const people = readFileSync("src/pages/People.jsx", "utf8");
assert.match(people, /\.select\("id, role, full_name, email, status, program_id, student_number", options\)/, "The account list reads each account's program and student number.");
assert.match(people, /hasSupabaseConfig && \(row\.role \|\| accountType\) !== STUDENT \? \[\{ icon: FiBookOpen, label: row\.programId \? "Change Program" : "Assign Program"/, "Every staff account, but no student, can be assigned a program.");

// Students created through Bulk Register are listed on Create Account with the staff, read in pages of 1000,
// show their student number under the name and no program, and Manage Accounts reloads after any create.
assert.match(people, /const listedTypes = \[\.\.\.accountTypes, STUDENT\];/);
assert.match(people, /fetchAllRows\(\(options\) => supabase\s*\.from\("profiles"\)[\s\S]*?\.in\("role", listedTypes\)/, "Every listed account is read, past the 1000-row limit.");
assert.match(people, /\{listedTypes\.map\(\(item\) => <option key=\{item\}>\{item\}<\/option>\)\}/, "The account type filter includes Student.");
assert.match(people, /<SelectField label="Account Type" value=\{selectedType\} onChange=\{\(event\) => setSelectedType\(event\.target\.value\)\}>\s*\{accountTypes\.map/, "Create Account still creates staff only.");
assert.match(people, /if \(\(row\.role \|\| accountType\) === STUDENT\) return <span className="account-program-none">-<\/span>;/, "Students show no program.");
assert.match(people, /row\.studentNumber \? <span>\{row\.name\}<small className="table-muted">\{row\.studentNumber\}<\/small><\/span> : row\.name/, "A student's number shows under the name.");
assert.match(people, /if \(listedTypes\.includes\(data\.profile\.role\)\) updateLiveProfile\(data\.profile\);\s*void queryClient\.invalidateQueries\(\{ queryKey: \["admin-accounts"\] \}\);/, "New accounts appear at once, here and in Manage Accounts.");
const accountFunction = readFileSync("supabase/functions/create-account/index.ts", "utf8");
assert.match(accountFunction, /const programId = String\(body\.programId \|\| ""\)\.trim\(\);/, "Every role may be created with a program.");
assert.match(accountFunction, /status: "Active",\s*program_id: program\?\.id \|\| null,/);

// Policy links (Privacy, Terms, Cookies & storage) open in the same tab.
for (const file of ["src/components/landing/SignInDialog.jsx", "src/pages/Login.jsx", "src/pages/ForgotPassword.jsx", "src/components/LegalLinks.jsx"]) {
  const source = readFileSync(file, "utf8");
  assert.match(source, /to=(?:"\/privacy"|\{`\/\$\{path\}`\})/, `${file} must link to the policies.`);
  assert.doesNotMatch(source, /target="_blank"/, `${file} must open policy links in the same tab.`);
}

console.log("Staff program and list polish checks passed.");
