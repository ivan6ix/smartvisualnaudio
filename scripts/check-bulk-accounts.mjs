/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { checkStaffRows, MAX_ROWS, normalizeRole, parseCsv, readStaffCsv, resultsCsv, templateCsv, toCsv } from "../src/lib/bulkAccounts.js";

// CSV reading: Excel BOM, CRLF, quoted commas, doubled quotes, line breaks in quotes and blank lines.
assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n"two\nlines",z'), [["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", "z"]]);
assert.deepEqual(parseCsv("a,b\n1,2\n"), [["a", "b"], ["1", "2"]], "A trailing line break adds no row.");
assert.deepEqual(parseCsv(" , \n"), [], "Rows with only spaces are skipped.");

assert.equal(normalizeRole("cluster  PROFESSOR"), "Cluster Professor");
assert.equal(normalizeRole("", "Dean"), "Dean", "A blank role uses the page's role.");
assert.equal(normalizeRole("student"), "Student", "Students can be bulk registered.");
assert.equal(normalizeRole("Admin"), null);

// Headers are matched loosely and in any order; rows keep their spreadsheet row number. Staff accounts have no
// employee number; the program column is optional.
const read = readStaffCsv("Email,Full Name,Role,Program\nANA@School.edu , Ana Reyes ,professor, bsit \n");
assert.equal(read.error, "");
assert.deepEqual(read.rows, [{ rowNumber: 2, fullName: "Ana Reyes", email: "ana@school.edu", roleText: "professor", role: "Professor", programCode: "BSIT", studentNumber: "" }]);
assert.equal(readStaffCsv("full_name,email\nBen,ben@x.edu", { defaultRole: "Dean" }).rows[0].role, "Dean", "No role column is fine on a role page.");
assert.equal(readStaffCsv("full_name,email,role\nBen,ben@x.edu,Dean").rows[0].programCode, "", "The program column is optional.");
assert.match(readStaffCsv("full_name,email\nBen,ben@x.edu").error, /role column/);
assert.match(readStaffCsv("name\nBen").error, /full_name, email, role \(program and student_number are optional\)/);
assert.match(readStaffCsv("").error, /needs these columns/);
assert.match(readStaffCsv("full_name,email,role\n").error, /no account rows/);
const tooMany = `full_name,email,role\n${Array.from({ length: MAX_ROWS + 1 }, (_, index) => `P${index},p${index}@x.edu,Dean`).join("\n")}`;
assert.match(readStaffCsv(tooMany).error, /201 rows/);

// Row checks: one problem per row, in the order an admin would fix them.
const programs = [{ id: "prog-bsit", program_code: "BSIT" }, { id: "prog-bscs", program_code: "bscs" }];
const csv = [
  "full_name,email,role,program",
  "Ana Reyes,ana@school.edu,Professor,BSIT",
  ",nobody@school.edu,Professor,",
  "Carla Lim,carla@school,Dean,",
  "Eva Tan,eva@school.edu,Registrar,",
  "Fe Uy,fe@school.edu,,",
  "Gil Ong,gil@school.edu,Dean,BSCS",
  "Gil Ong Jr,GIL@school.edu,Dean,",
  "Hal Go,hal@school.edu,Dean,BSHM",
  "Ivy Sy,ivy@school.edu,Cluster Professor,BSIT",
  "Jo Lee,jo@school.edu,Professor,",
].join("\n");
const checked = checkStaffRows(readStaffCsv(csv).rows, { existingEmails: ["IVY@school.edu"], programs });
assert.deepEqual(checked.map((row) => [row.rowNumber, row.problem]), [
  [2, null],
  [3, "Full name is missing"],
  [4, "Email is not valid"],
  [5, 'Role "Registrar" is not Professor, Dean, Cluster Professor or Student'],
  [6, "Role is missing"],
  [7, "Email appears more than once in the file"],
  [8, "Email appears more than once in the file"],
  [9, 'Program "BSHM" is not an active program'],
  [10, "Email already has an account"],
  [11, null],
]);
assert.equal(checked[0].programId, "prog-bsit", "A known program code is turned into its program id.");
assert.equal(checked[9].programId, "", "A row without a program is created without one.");
assert.equal(checkStaffRows(readStaffCsv("full_name,email,role,program\nGil,gil@x.edu,Dean,bscs").rows, { programs })[0].programId, "prog-bscs", "Program codes match regardless of case.");

// Students: a student number is required and unique; students have no program; staff have no student number.
const studentCsv = [
  "full_name,email,role,program,student_number",
  "Lia Cruz,lia@school.edu,Student,,2026-0001",
  "Mon Diaz,mon@school.edu,Student,,",
  "Nia Go,nia@school.edu,Student,BSIT,2026-0003",
  "Oli Tan,oli@school.edu,Professor,BSIT,2026-0004",
  "Pia Uy,pia@school.edu,Student,,2026-0005",
  "Quin Sy,quin@school.edu,Student,,2026-0005",
  "Ria Lim,ria@school.edu,student,,2026-0420",
].join("\n");
const students = checkStaffRows(readStaffCsv(studentCsv).rows, { existingEmails: [], existingStudentNumbers: ["2026-0420"], programs });
assert.deepEqual(students.map((row) => [row.rowNumber, row.problem]), [
  [2, null],
  [3, "Student number is missing"],
  [4, "Leave program blank for students"],
  [5, "Leave student number blank for staff"],
  [6, "Student number appears more than once in the file"],
  [7, "Student number appears more than once in the file"],
  [8, "Student number already has an account"],
]);
assert.equal(students[0].studentNumber, "2026-0001");
assert.equal(students[0].programId, "", "Students are created without a program.");

// Files written for the admin.
assert.equal(templateCsv("Dean"), "full_name,email,role,program,student_number\r\nJuan Dela Cruz,juan.delacruz@school.edu,Dean,BSIT,\r\nMaria Santos,maria.santos@school.edu,Student,,2026-0001\r\n");
assert.equal(toCsv([["=1+1", "a,b", 'q"t', "-5"]]), `'=1+1,"a,b","q""t",'-5\r\n`, "Formula-like cells are written as text.");
const results = new Map([[2, { status: "Created", message: "" }], [3, { status: "Failed", message: "A user with this email address has already been registered" }]]);
const written = resultsCsv([
  { rowNumber: 2, fullName: "Ana", email: "ana@x.edu", role: "Dean", roleText: "Dean", programCode: "BSIT", studentNumber: "", problem: null },
  { rowNumber: 3, fullName: "Ben", email: "ben@x.edu", role: "Student", roleText: "Student", programCode: "", studentNumber: "2026-0002", problem: null },
  { rowNumber: 4, fullName: "Cy", email: "cy@x", role: "Dean", roleText: "Dean", programCode: "", studentNumber: "", problem: "Email is not valid" },
], results);
assert.equal(written.split("\r\n")[0], "row,full_name,email,role,program,student_number,result,details");
assert.equal(written.split("\r\n")[1], "2,Ana,ana@x.edu,Dean,BSIT,,Created,");
assert.equal(written.split("\r\n")[2], "3,Ben,ben@x.edu,Student,,2026-0002,Failed,A user with this email address has already been registered");
assert.equal(written.split("\r\n")[3], "4,Cy,cy@x,Dean,,,Skipped,Email is not valid");
assert.doesNotMatch(written, /password|123456/i, "The results file never holds passwords.");

// Wiring.
const people = readFileSync("src/pages/People.jsx", "utf8");
const modal = readFileSync("src/components/admin/BulkRegisterModal.jsx", "utf8");
assert.match(people, /<BulkRegisterModal[\s\S]*?createAccount=\{createAccount\}/, "Bulk and single create share one create path.");
assert.match(people, /<BulkRegisterModal[\s\S]*?programs=\{activePrograms\}/, "Bulk register checks program codes against the active programs.");
assert.match(people, /async function createAccount[\s\S]*?action: "create"/, "Each account goes through the create-account function's create action.");
assert.match(people, /Bulk Register/);
assert.match(modal, /for \(const row of ready\)[\s\S]*?await createAccount\(\{[^}]*programId: row\.programId, studentNumber: row\.studentNumber/, "Accounts are created one at a time with their program or student number.");
assert.match(modal, /select\("id, email, student_number", options\)/, "Existing student numbers are read before checking the file.");
assert.match(people, /\.\.\.\(role === STUDENT \? \{ studentNumber \} : \{\}\)/, "Students are created with their student number.");
assert.match(people, /const STUDENT = "Student";/);
const accountFunction = readFileSync("supabase/functions/create-account/index.ts", "utf8");
assert.match(accountFunction, /const creatableRoles = new Set\(\[\.\.\.allowedRoles, "Student"\]\);/, "The create-account function can create students.");
assert.match(accountFunction, /if \(isStudent && !studentNumber\) return json\(\{ error: "A student number is required for a student account\." \}, 400\);/);
assert.match(accountFunction, /\.eq\("student_number", studentNumber\)/, "A taken student number is refused before the account is created.");
assert.match(accountFunction, /const programId = isStudent \? "" :/, "Students get no program.");
assert.match(accountFunction, /if \(!allowedRoles\.has\(target\.role\)\) return json/, "Only staff accounts are assigned a program.");
assert.match(modal, /checkStaffRows/);
assert.match(modal, /Download template/);
assert.doesNotMatch(modal, /employee/i, "Bulk register has no employee number.");

console.log("Bulk account checks passed.");
