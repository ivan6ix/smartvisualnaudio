/* global console */
// Bulk Register enrolls students in courses by joining code: new students right after their account is created,
// and students who already have an account through the enroll action (the account itself is left as it is).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fn = readFileSync("supabase/functions/create-account/index.ts", "utf8");
assert.match(fn, /function readCourseCodes\(/);
assert.match(fn, /split\(\/\[\\s,;\]\+\/\)/, "The server splits codes on spaces, commas, semicolons and line breaks, like the sheet.");
assert.match(fn, /codes\.length > 20[\s\S]*?"List at most 20 courses\."/);
assert.match(fn, /\.length > 32[\s\S]*?"A course code is longer than 32 characters\."/);
assert.match(fn, /async function enrollInCourses\(/);
assert.match(fn, /\.from\("courses"\)[\s\S]*?\.in\("joining_code", codes\)[\s\S]*?\.eq\("archived", false\)/, "Only active courses, matched by joining code.");
// upsert ... ignoreDuplicates: an already-enrolled course is not an error and adds no row.
assert.match(fn, /\.from\("course_enrollments"\)[\s\S]*?\.upsert\([\s\S]*?onConflict: "course_id,student_id", ignoreDuplicates: true/);
const createStart = fn.indexOf('if (action === "create")');
const enrollStart = fn.indexOf('if (action === "enroll")');
assert.ok(enrollStart > 0, "There is an enroll action.");
const createBlock = fn.slice(createStart, fn.indexOf('if (action === "assign-program")'));
assert.match(createBlock, /!isStudent && courseCodes\.codes\.length[\s\S]*?"Courses are for students only\."/);
assert.ok(createBlock.indexOf("enrollInCourses(") > createBlock.indexOf('action: "Account Created"'), "Enrolling happens after the account and its log entry exist.");
assert.match(createBlock, /return json\(\{ profile, enrolled, skipped \}\)/);
const enrollBlock = fn.slice(enrollStart, fn.indexOf('if (action === "assign-program")'));
assert.match(enrollBlock, /\.eq\("email", email\)/);
assert.match(enrollBlock, /"List at least one course\."/);
assert.match(enrollBlock, /No account uses the email/);
assert.match(enrollBlock, /role !== "Student"[\s\S]*?is not a student account\./);
assert.match(enrollBlock, /status !== "Active"[\s\S]*?is deactivated\./);
assert.match(enrollBlock, /does not match this account\./);
assert.match(enrollBlock, /return json\(\{ profile: \{ id: student\.id, full_name: student\.full_name, email: student\.email \}, enrolled, skipped \}\)/);
assert.match(fn, /action: "Student Enrolled"/);
assert.ok(enrollStart > fn.indexOf("adminRoles.has(caller.role)"), "enroll is behind the Admin check.");

// The Bulk Register screen: existing students and active courses are loaded, rows are created or enrolled, and
// only codes of active courses are sent.
const modal = readFileSync("src/components/admin/BulkRegisterModal.jsx", "utf8");
assert.match(modal, /select\("id, email, role, status, full_name, student_number", options\)/, "Existing accounts are read with role and status.");
assert.match(modal, /from\("courses"\)[\s\S]*?\.eq\("archived", false\)/, "Active courses are loaded for checks and the template.");
assert.match(modal, /fetchAllRows\(\(options\) => supabase\s*\.from\("courses"\)/, "Every active course is read, past the 1000-row limit.");
assert.match(modal, /if \(error \|\| coursesError\)[\s\S]*?setLoadError\(/, "If accounts or courses cannot be read, the upload stays blocked instead of treating every code as unknown.");
assert.match(modal, /Will enroll \$\{row\.matchedName\}/, "The preview names the existing account that will be enrolled.");
assert.match(modal, /existingStudents[\s\S]*?courses: activeCourses/, "Rows are checked against existing students and courses.");
assert.match(modal, /row\.mode === "enroll"\s*\?\s*await enrollStudent\(/);
assert.match(modal, /courseCodes: row\.knownCodes/, "Only known codes are sent.");
assert.match(modal, /templateSheets\(defaultRole \|\| "Professor", programs, activeCourses, professorNames\)/);
assert.match(modal, /Will enroll/);
const people = readFileSync("src/pages/People.jsx", "utf8");
assert.match(people, /async function enrollStudent\(/);
assert.match(people, /action: "enroll"/);
assert.match(people, /enrollStudent=\{enrollStudent\}/);
assert.match(people, /async function createAccount\([^)]*courseCodes = \[\][^)]*\)/);
assert.match(people, /role === STUDENT \? \{ studentNumber, courseCodes \} : \{\}/, "Course codes are sent for students only.");

console.log("Bulk course enrollment checks passed.");
