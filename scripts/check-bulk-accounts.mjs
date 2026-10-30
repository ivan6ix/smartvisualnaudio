/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { checkStaffRows, MAX_ROWS, normalizeRole, parseCsv, readStaffCsv, resultsCsv, templateCsv, toCsv } from "../src/lib/bulkAccounts.js";

// CSV reading: Excel BOM, CRLF, quoted commas, doubled quotes, line breaks in quotes and blank lines.
assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n\r\n"two\nlines",z'), [["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", "z"]]);
assert.deepEqual(parseCsv("a,b\n1,2\n"), [["a", "b"], ["1", "2"]], "A trailing line break adds no row.");
assert.deepEqual(parseCsv(" , \n"), [], "Rows with only spaces are skipped.");

assert.equal(normalizeRole("cluster  PROFESSOR"), "Cluster Professor");
assert.equal(normalizeRole("", "Dean"), "Dean", "A blank role uses the page's role.");
assert.equal(normalizeRole("Student"), null, "Students cannot be created here.");
assert.equal(normalizeRole("Admin"), null);

// Headers are matched loosely and in any order; rows keep their spreadsheet row number.
const read = readStaffCsv("Email,Full Name,Employee Number,Role\nANA@School.edu , Ana Reyes ,EMP-1,professor\n");
assert.equal(read.error, "");
assert.deepEqual(read.rows, [{ rowNumber: 2, fullName: "Ana Reyes", email: "ana@school.edu", employeeNumber: "EMP-1", roleText: "professor", role: "Professor" }]);
assert.equal(readStaffCsv("full_name,email,employee_number\nBen,ben@x.edu,E2", { defaultRole: "Dean" }).rows[0].role, "Dean", "No role column is fine on a role page.");
assert.match(readStaffCsv("full_name,email,employee_number\nBen,ben@x.edu,E2").error, /role column/);
assert.match(readStaffCsv("name,email\nBen,ben@x.edu").error, /full_name, email, employee_number, role/);
assert.match(readStaffCsv("").error, /needs these columns/);
assert.match(readStaffCsv("full_name,email,employee_number,role\n").error, /no staff rows/);
const tooMany = `full_name,email,employee_number,role\n${Array.from({ length: MAX_ROWS + 1 }, (_, index) => `P${index},p${index}@x.edu,E${index},Dean`).join("\n")}`;
assert.match(readStaffCsv(tooMany).error, /201 rows/);

// Row checks: one problem per row, in the order an admin would fix them.
const csv = [
  "full_name,email,employee_number,role",
  "Ana Reyes,ana@school.edu,EMP-1,Professor",
  ",nobody@school.edu,EMP-2,Professor",
  "Carla Lim,carla@school,EMP-3,Dean",
  "Dan Cruz,dan@school.edu,,Dean",
  "Eva Tan,eva@school.edu,EMP-5,Registrar",
  "Fe Uy,fe@school.edu,EMP-6,",
  "Gil Ong,gil@school.edu,EMP-7,Dean",
  "Gil Ong Jr,GIL@school.edu,EMP-8,Dean",
  "Hal Go,hal@school.edu,emp-1,Dean",
  "Ivy Sy,ivy@school.edu,EMP-10,Cluster Professor",
  "Jo Lee,jo@school.edu,EMP-0420,Professor",
].join("\n");
const checked = checkStaffRows(readStaffCsv(csv).rows, { existingEmails: ["IVY@school.edu"], existingEmployeeNumbers: ["emp-0420"] });
assert.deepEqual(checked.map((row) => [row.rowNumber, row.problem]), [
  [2, "Employee number appears more than once in the file"],
  [3, "Full name is missing"],
  [4, "Email is not valid"],
  [5, "Employee number is missing"],
  [6, 'Role "Registrar" is not Professor, Dean or Cluster Professor'],
  [7, "Role is missing"],
  [8, "Email appears more than once in the file"],
  [9, "Email appears more than once in the file"],
  [10, "Employee number appears more than once in the file"],
  [11, "Email already has an account"],
  [12, "Employee number already has an account"],
]);
assert.equal(checkStaffRows(readStaffCsv("full_name,email,employee_number,role\nAna,ana@x.edu,E1,Dean").rows)[0].problem, null);

// Files written for the admin.
assert.equal(templateCsv("Dean"), "full_name,email,employee_number,role\r\nJuan Dela Cruz,juan.delacruz@school.edu,EMP-0001,Dean\r\n");
assert.equal(toCsv([["=1+1", "a,b", 'q"t', "-5"]]), `'=1+1,"a,b","q""t",'-5\r\n`, "Formula-like cells are written as text.");
const results = new Map([[2, { status: "Created", message: "" }], [3, { status: "Failed", message: "A user with this email address has already been registered" }]]);
const written = resultsCsv([
  { rowNumber: 2, fullName: "Ana", email: "ana@x.edu", employeeNumber: "E1", role: "Dean", roleText: "Dean", problem: null },
  { rowNumber: 3, fullName: "Ben", email: "ben@x.edu", employeeNumber: "E2", role: "Dean", roleText: "Dean", problem: null },
  { rowNumber: 4, fullName: "Cy", email: "cy@x", employeeNumber: "E3", role: "Dean", roleText: "Dean", problem: "Email is not valid" },
], results);
assert.equal(written.split("\r\n")[0], "row,full_name,email,employee_number,role,result,details");
assert.equal(written.split("\r\n")[2], "3,Ben,ben@x.edu,E2,Dean,Failed,A user with this email address has already been registered");
assert.equal(written.split("\r\n")[3], "4,Cy,cy@x,E3,Dean,Skipped,Email is not valid");
assert.doesNotMatch(written, /password|123456/i, "The results file never holds passwords.");

// Wiring.
const people = readFileSync("src/pages/People.jsx", "utf8");
const modal = readFileSync("src/components/admin/BulkRegisterModal.jsx", "utf8");
assert.match(people, /<BulkRegisterModal[\s\S]*?createAccount=\{createAccount\}/, "Bulk and single create share one create path.");
assert.match(people, /async function createAccount[\s\S]*?action: "create"/, "Each account goes through the create-account function's create action.");
assert.match(people, /Bulk Register/);
assert.match(modal, /for \(const row of ready\)[\s\S]*?await createAccount/, "Accounts are created one at a time.");
assert.match(modal, /checkStaffRows/);
assert.match(modal, /Download template/);

console.log("Bulk account checks passed.");
