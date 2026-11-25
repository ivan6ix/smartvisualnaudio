// Bulk registration: reads an Excel (.xlsx) or CSV file of staff and students, checks each row before anything
// is created, and builds the template and results files. Accounts are created one at a time through the
// create-account function, so each one gets the same checks and audit log entry as a single Create Account.

export const STAFF_ROLES = ["Professor", "Dean", "Cluster Professor"];
// Students can be bulk registered too. A student needs a student number and has no program; staff have no
// student number and may have a program.
export const BULK_ROLES = [...STAFF_ROLES, "Student"];
export const MAX_ROWS = 200;
// Staff accounts have no employee number. The program column is optional; when filled it must be an active
// program code, and the account is assigned to that program.
// The courses column is optional and for students only: joining codes of the courses the student is enrolled in.
// A student whose email already has an account is enrolled in those courses instead of being created again.
export const TEMPLATE_HEADERS = ["full_name", "email", "role", "program", "student_number", "courses"];
export const MAX_COURSES_PER_ROW = 20;
export const MAX_COURSE_CODE_LENGTH = 32;
const REQUIRED_HEADERS = ["full_name", "email", "role"];
const ROLE_LIST = "Professor, Dean, Cluster Professor or Student";

const HEADER_ALIASES = {
  fullName: ["full_name", "full name", "name"],
  email: ["email", "email address"],
  role: ["role", "account type"],
  programCode: ["program", "program_code", "program code"],
  studentNumber: ["student_number", "student number", "student no", "student no.", "student id"],
  courseCodes: ["courses", "course", "course_codes", "course codes", "joining codes"],
};
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "x7k2qd; M4P9TR" -> ["X7K2QD", "M4P9TR"]: commas, semicolons, spaces and line breaks separate codes (joining
// codes never contain spaces); repeats are dropped.
export function splitCourseCodes(text) {
  const codes = String(text || "").split(/[\s,;]+/).map((code) => code.trim().toUpperCase()).filter(Boolean);
  return [...new Set(codes)];
}

// RFC 4180 style: quoted cells may hold commas, line breaks and doubled quotes. Excel's BOM is dropped.
export function parseCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim()));
}

export function normalizeRole(value, defaultRole = "") {
  const text = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) return defaultRole;
  return BULK_ROLES.find((role) => role.toLowerCase() === text) || null;
}

// A cell read from an Excel file may be a number, a date, a boolean or empty; rows are checked as text.
export function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return String(value);
}

// Reads the first sheet of an Excel file or the lines of a CSV file, already split into cells.
export function readStaffCsv(text, options = {}) {
  return readStaffRows(parseCsv(text), options);
}

// Rows keep their spreadsheet row number (the header is row 1) so problems can be found in the file.
export function readStaffRows(cellRows, { defaultRole = "" } = {}) {
  const [header = [], ...body] = (cellRows || [])
    .map((cells) => (cells || []).map(cellText))
    .filter((cells) => cells.some((value) => value.trim()));
  const columns = {};
  header.forEach((name, index) => {
    const key = Object.keys(HEADER_ALIASES).find((field) => HEADER_ALIASES[field].includes(name.trim().toLowerCase()));
    if (key && columns[key] === undefined) columns[key] = index;
  });
  const missing = ["fullName", "email"].filter((field) => columns[field] === undefined);
  if (!header.length || missing.length) {
    return { rows: [], error: `The file needs these columns: ${REQUIRED_HEADERS.join(", ")} (program, student_number and courses are optional). Download the template to start from.` };
  }
  if (columns.role === undefined && !defaultRole) {
    return { rows: [], error: `The file needs a role column with ${ROLE_LIST}.` };
  }
  if (!body.length) return { rows: [], error: "The file has no account rows under the header." };
  if (body.length > MAX_ROWS) return { rows: [], error: `The file has ${body.length} rows. Upload at most ${MAX_ROWS} at a time.` };
  const cell = (cells, field) => (columns[field] === undefined ? "" : String(cells[columns[field]] || "").trim());
  return {
    error: "",
    rows: body.map((cells, index) => ({
      rowNumber: index + 2,
      fullName: cell(cells, "fullName"),
      email: cell(cells, "email").toLowerCase(),
      roleText: cell(cells, "role"),
      role: normalizeRole(cell(cells, "role"), defaultRole),
      programCode: cell(cells, "programCode").toUpperCase(),
      studentNumber: cell(cells, "studentNumber"),
      courseCodes: splitCourseCodes(cell(cells, "courseCodes")),
    })),
  };
}

// Adds `problem` (null when the row is ready), `programId` for a known program code, `mode` ("create", or "enroll"
// for a student whose email already has an account and who has courses listed) and the row's course codes split
// into `knownCodes` (active courses) and `unknownCodes` (skipped, a warning rather than a problem). Existing emails
// and student numbers come from profiles; existingStudents are the Student profiles ({ email, studentNumber,
// status, fullName }); programs are the active programs ({ id, program_code }); courses are the active courses ({ joining_code }).
export function checkStaffRows(rows, { existingEmails = [], existingStudentNumbers = [], programs = [], existingStudents = [], courses = [] } = {}) {
  const takenEmails = new Set(existingEmails.map((value) => String(value || "").trim().toLowerCase()));
  const takenNumbers = new Set(existingStudentNumbers.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  const programByCode = new Map(programs.map((program) => [String(program.program_code || "").trim().toUpperCase(), program.id]));
  const studentByEmail = new Map(existingStudents.map((student) => [String(student.email || "").trim().toLowerCase(), student]));
  const activeCodes = new Set(courses.map((course) => String(course.joining_code || "").trim().toUpperCase()).filter(Boolean));
  const countBy = (pick) => rows.reduce((counts, row) => {
    const value = pick(row);
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  }, new Map());
  const emailCounts = countBy((row) => row.email);
  const numberCounts = countBy((row) => String(row.studentNumber || "").toLowerCase());
  return rows.map((row) => {
    const isStudent = row.role === "Student";
    const number = String(row.studentNumber || "").trim().toLowerCase();
    const programId = !isStudent && row.programCode ? programByCode.get(row.programCode) || "" : "";
    const courseCodes = row.courseCodes || [];
    const knownCodes = courseCodes.filter((code) => activeCodes.has(code));
    const unknownCodes = courseCodes.filter((code) => !activeCodes.has(code));
    const existingStudent = studentByEmail.get(row.email);
    // An existing student is enrolled in the listed courses; the account itself is left as it is.
    const mode = isStudent && courseCodes.length && takenEmails.has(row.email) && existingStudent ? "enroll" : "create";
    let problem = null;
    if (!row.fullName) problem = "Full name is missing";
    else if (!row.email) problem = "Email is missing";
    else if (!EMAIL_PATTERN.test(row.email)) problem = "Email is not valid";
    else if (!row.role) problem = row.roleText ? `Role "${row.roleText}" is not ${ROLE_LIST}` : "Role is missing";
    else if (isStudent && !row.studentNumber && mode === "create") problem = "Student number is missing";
    else if (isStudent && row.programCode) problem = "Leave program blank for students";
    else if (!isStudent && row.studentNumber) problem = "Leave student number blank for staff";
    else if (!isStudent && courseCodes.length) problem = "Courses are for students only";
    else if (courseCodes.length > MAX_COURSES_PER_ROW) problem = `List at most ${MAX_COURSES_PER_ROW} courses`;
    else if (courseCodes.some((code) => code.length > MAX_COURSE_CODE_LENGTH)) problem = `A course code is longer than ${MAX_COURSE_CODE_LENGTH} characters`;
    else if (row.programCode && !programId) problem = `Program "${row.programCode}" is not an active program`;
    else if (emailCounts.get(row.email) > 1) problem = "Email appears more than once in the file";
    else if (isStudent && numberCounts.get(number) > 1) problem = "Student number appears more than once in the file";
    else if (mode === "enroll" && existingStudent.status !== "Active") problem = "Account is deactivated";
    else if (mode === "enroll" && number && number !== String(existingStudent.studentNumber || "").trim().toLowerCase()) problem = "Student number does not match this account";
    else if (mode === "enroll" && !knownCodes.length) problem = "None of the listed courses were found";
    else if (mode === "create" && takenEmails.has(row.email)) problem = "Email already has an account";
    else if (mode === "create" && isStudent && takenNumbers.has(number)) problem = "Student number already has an account";
    // The preview names the account an enroll row will change, so a wrong email is noticed before upload.
    const matchedName = mode === "enroll" ? existingStudent.fullName || existingStudent.email || "" : "";
    return { ...row, programId, mode, matchedName, knownCodes, unknownCodes, problem };
  });
}

// Excel runs cells that start with these characters as formulas, so they are written as text.
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows) {
  return `${rows.map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

const EXAMPLE_COURSE_CODE = "X7K2QD";
const exampleStudent = (courseCode = EXAMPLE_COURSE_CODE) => ["Maria Santos", "maria.santos@school.edu", "Student", "", "2026-0001", courseCode];

export function templateCsv(defaultRole = "Professor") {
  return toCsv([TEMPLATE_HEADERS, ["Juan Dela Cruz", "juan.delacruz@school.edu", defaultRole, "BSIT", "", ""], exampleStudent()]);
}

// results: Map of rowNumber -> { status: "Created" | "Enrolled" | "Failed", message, enrolled?, skipped? }, where
// enrolled and skipped are course codes. Rows never sent show as Skipped.
const RESULTS_HEADERS = ["row", "full_name", "email", "role", "program", "student_number", "result", "details", "courses", "courses_enrolled", "courses_skipped"];
function resultRows(rows, results) {
  return rows.map((row) => {
    const result = results.get(row.rowNumber);
    return [
      row.rowNumber,
      row.fullName,
      row.email,
      row.role || row.roleText,
      row.programCode || "",
      row.studentNumber || "",
      result?.status || "Skipped",
      result?.message || row.problem || "",
      (row.courseCodes || []).join(", "),
      (result?.enrolled || []).join(", "),
      (result?.skipped || []).join(", "),
    ];
  });
}

export function resultsCsv(rows, results) {
  return toCsv([RESULTS_HEADERS, ...resultRows(rows, results)]);
}

// Excel workbooks, written with write-excel-file. A CSV file cannot store column widths or bold text, so the
// template and the results are offered as .xlsx files that open readable in Excel.
const headerCell = (value) => ({ value, fontWeight: "bold", backgroundColor: "#D9E2F3" });
const textCell = (value) => ({ value: value === null || value === undefined ? "" : String(value) });

const COURSE_SHEET_HEADERS = ["joining_code", "course_code", "course_name", "section", "year_level", "semester", "academic_year", "program", "professor"];

// Sheet 1 "Accounts" is what the upload reads (header plus a staff and a student example row); sheet 2 explains
// each column and lists the active program codes; sheet 3 lists the active courses (rows from `courses` with
// programs(program_code)) and their joining codes, with professorNames mapping professor_id to a name.
export function templateSheets(defaultRole = "Professor", programs = [], courses = [], professorNames = new Map()) {
  const codes = programs.map((program) => String(program.program_code || "").trim()).filter(Boolean);
  const exampleStaff = ["Juan Dela Cruz", "juan.delacruz@school.edu", defaultRole, codes[0] || "BSIT", "", ""];
  const courseRows = courses.map((course) => [
    course.joining_code,
    course.course_code,
    course.course_name,
    course.section,
    course.year_level,
    course.semester,
    course.academic_year,
    course.programs?.program_code || "",
    professorNames.get(course.professor_id) || "Unassigned",
  ].map(textCell));
  return [
    {
      sheet: "Accounts",
      data: [TEMPLATE_HEADERS.map(headerCell), exampleStaff.map(textCell), exampleStudent(courses[0]?.joining_code || EXAMPLE_COURSE_CODE).map(textCell)],
      columns: [{ width: 28 }, { width: 34 }, { width: 20 }, { width: 14 }, { width: 18 }, { width: 22 }],
      stickyRowsCount: 1,
    },
    {
      sheet: "How to fill",
      data: [
        ["Column", "What to type"].map(headerCell),
        ["full_name", "The person's full name. Required."].map(textCell),
        ["email", "A valid email address that has no account yet. Required."].map(textCell),
        ["role", `${ROLE_LIST}. Required.`].map(textCell),
        ["program", `Staff only, optional. An active program code: ${codes.length ? codes.join(", ") : "see Academic Programs"}. Leave blank for students.`].map(textCell),
        ["student_number", "Students only, required for them, for example 2026-0001. Must not belong to another account. Leave blank for staff."].map(textCell),
        ["courses", "Students only, optional. Joining codes from the Courses sheet, separated by commas. For a student who already has an account, the row enrolls that account in these courses."].map(textCell),
        ["", ""].map(textCell),
        ["Note", "Replace the example rows on the Accounts sheet, keep the header row, and upload this file as it is. Up to 200 rows."].map(textCell),
        ["Sign-in", "Every account starts with the default password chosen in Bulk Register and must set its own password at first sign-in."].map(textCell),
      ],
      columns: [{ width: 16 }, { width: 100 }],
    },
    {
      sheet: "Courses",
      data: [COURSE_SHEET_HEADERS.map(headerCell), ...courseRows],
      columns: [{ width: 14 }, { width: 14 }, { width: 34 }, { width: 10 }, { width: 11 }, { width: 11 }, { width: 14 }, { width: 10 }, { width: 26 }],
      stickyRowsCount: 1,
    },
  ];
}

export function resultsSheet(rows, results) {
  return {
    sheet: "Results",
    data: [RESULTS_HEADERS.map(headerCell), ...resultRows(rows, results).map((cells) => cells.map(textCell))],
    columns: [{ width: 7 }, { width: 28 }, { width: 34 }, { width: 18 }, { width: 11 }, { width: 16 }, { width: 11 }, { width: 60 }, { width: 22 }, { width: 22 }, { width: 22 }],
    stickyRowsCount: 1,
  };
}
