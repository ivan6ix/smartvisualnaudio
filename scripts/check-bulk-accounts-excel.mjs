/* global console, structuredClone */
// Round trip: the Excel template written by write-excel-file reads back through read-excel-file into the same
// row checks as a CSV upload, and the results workbook is readable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import writeExcelFile from "write-excel-file/node";
import { readSheet } from "read-excel-file/node";

import { cellText, checkStaffRows, readStaffRows, resultsSheet, templateSheets, TEMPLATE_HEADERS } from "../src/lib/bulkAccounts.js";

const programs = [{ id: "prog-bsit", program_code: "BSIT" }, { id: "prog-bscs", program_code: "BSCS" }];

// The template: Accounts sheet first (header + a staff and a student example), then How to fill.
const sheets = templateSheets("Dean", programs);
assert.deepEqual(sheets.map((sheet) => sheet.sheet), ["Accounts", "How to fill", "Courses"]);
assert.deepEqual(sheets[0].data[0].map((cell) => cell.value), TEMPLATE_HEADERS);
assert.ok(sheets[0].data[0].every((cell) => cell.fontWeight === "bold"), "The header row is bold.");
assert.ok(sheets[0].columns.every((column) => column.width >= 14), "Columns are wide enough to read.");
assert.equal(sheets[0].stickyRowsCount, 1, "The header row stays visible while scrolling.");
assert.match(sheets[1].data.map((row) => row.map((cell) => cell.value).join(" ")).join("\n"), /BSIT, BSCS/, "How to fill lists the active program codes.");

// Write the template, add two staff rows as an admin would, and read it back like an upload.
const filled = structuredClone(sheets);
filled[0].data.push(
  [{ value: "Ana Reyes" }, { value: "ANA@School.edu" }, { value: "professor" }, { value: "bscs" }, { value: "" }],
  [{ value: "Ben Cruz" }, { value: "ben@school.edu" }, { value: "Cluster Professor" }, { value: "" }, { value: "" }],
  // A student number typed as a number in Excel still reads as text.
  [{ value: "Cara Lim" }, { value: "cara@school.edu" }, { value: "Student" }, { value: "" }, { value: 20260007, type: Number }],
);
const buffer = await writeExcelFile(filled).toBuffer();
const read = readStaffRows(await readSheet(buffer), { defaultRole: "" });
assert.equal(read.error, "");
assert.deepEqual(read.rows.map((row) => [row.rowNumber, row.fullName, row.email, row.role, row.programCode, row.studentNumber]), [
  [2, "Juan Dela Cruz", "juan.delacruz@school.edu", "Dean", "BSIT", ""],
  [3, "Maria Santos", "maria.santos@school.edu", "Student", "", "2026-0001"],
  [4, "Ana Reyes", "ana@school.edu", "Professor", "BSCS", ""],
  [5, "Ben Cruz", "ben@school.edu", "Cluster Professor", "", ""],
  [6, "Cara Lim", "cara@school.edu", "Student", "", "20260007"],
]);
const checked = checkStaffRows(read.rows, { existingEmails: [], existingStudentNumbers: [], programs });
assert.deepEqual(checked.map((row) => [row.problem, row.programId]), [[null, "prog-bsit"], [null, ""], [null, "prog-bscs"], [null, ""], [null, ""]], "Excel rows go through the same checks as CSV rows.");

// The Courses sheet lists every active course with its joining code; the student example uses a real code.
const courseRows = [{ id: "c1", joining_code: "X7K2QD", course_code: "IT 101", course_name: "Intro to Computing", section: "2A", year_level: "2", semester: "1st", academic_year: "2026-2027", professor_id: "p1", programs: { program_code: "BSIT" } }];
const withCourses = templateSheets("Dean", programs, courseRows, new Map([["p1", "Ana Reyes"]]));
assert.deepEqual(withCourses.map((sheet) => sheet.sheet), ["Accounts", "How to fill", "Courses"]);
assert.deepEqual(withCourses[2].data[0].map((cell) => cell.value), ["joining_code", "course_code", "course_name", "section", "year_level", "semester", "academic_year", "program", "professor"]);
assert.deepEqual(withCourses[2].data[1].map((cell) => cell.value), ["X7K2QD", "IT 101", "Intro to Computing", "2A", "2", "1st", "2026-2027", "BSIT", "Ana Reyes"]);
assert.equal(withCourses[0].data[2].at(-1).value, "X7K2QD", "The student example uses a real active code when there is one.");
assert.equal(templateSheets("Dean", programs, [{ ...courseRows[0], professor_id: null }])[2].data[1].at(-1).value, "Unassigned");
assert.match(withCourses[1].data.map((row) => row.map((cell) => cell.value).join(" ")).join("\n"), /courses .*Joining codes from the Courses sheet/);
// numeric course code cell: an all-digit joining code arrives from Excel as a number.
assert.deepEqual(readStaffRows([["full_name", "email", "role", "student_number", "courses"], ["Mia", "mia@x.edu", "Student", "2026-9", 482913]]).rows[0].courseCodes, ["482913"]);

// Numbers, dates and empty cells from Excel become text before the checks.
assert.equal(cellText(42), "42");
assert.equal(cellText(null), "");
assert.equal(cellText(new Date(Date.UTC(2026, 10, 21))), "2026-11-21");

// The results workbook writes and reads back with its header.
const resultsBook = await writeExcelFile([resultsSheet(checked, new Map([[2, { status: "Created", message: "" }]]))]).toBuffer();
const resultRows = await readSheet(resultsBook);
assert.deepEqual(resultRows[0], ["row", "full_name", "email", "role", "program", "student_number", "result", "details", "courses", "courses_enrolled", "courses_skipped"]);
// An empty cell reads back as null from Excel.
assert.deepEqual(resultRows[1].slice(0, 7), ["2", "Juan Dela Cruz", "juan.delacruz@school.edu", "Dean", "BSIT", null, "Created"]);

// Wiring: the modal accepts .xlsx and .csv, loads the Excel libraries only when needed, and downloads .xlsx files.
const modal = readFileSync("src/components/admin/BulkRegisterModal.jsx", "utf8");
assert.match(modal, /accept="\.xlsx,\.csv/);
assert.match(modal, /await import\("write-excel-file\/browser"\)/);
assert.match(modal, /await import\("read-excel-file\/browser"\)/);
assert.match(modal, /"staff-template\.xlsx"/);
assert.match(modal, /"staff-registration-results\.xlsx"/);
assert.doesNotMatch(modal, /^import .*excel-file/m, "The Excel libraries are not part of the main bundle.");

console.log("Bulk account Excel checks passed.");
