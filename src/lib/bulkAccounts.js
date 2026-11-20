// Bulk staff registration: reads an Excel (.xlsx) or CSV file of staff, checks each row before anything is
// created, and builds the template and results files. Accounts are created one at a time through the create-account function, so each
// one gets the same checks and audit log entry as a single Create Account.

export const STAFF_ROLES = ["Professor", "Dean", "Cluster Professor"];
export const MAX_ROWS = 200;
// Staff accounts have no employee number. The program column is optional; when filled it must be an active
// program code, and the account is assigned to that program.
export const TEMPLATE_HEADERS = ["full_name", "email", "role", "program"];
const REQUIRED_HEADERS = ["full_name", "email", "role"];

const HEADER_ALIASES = {
  fullName: ["full_name", "full name", "name"],
  email: ["email", "email address"],
  role: ["role", "account type"],
  programCode: ["program", "program_code", "program code"],
};
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  return STAFF_ROLES.find((role) => role.toLowerCase() === text) || null;
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
    return { rows: [], error: `The file needs these columns: ${REQUIRED_HEADERS.join(", ")} (program is optional). Download the template to start from.` };
  }
  if (columns.role === undefined && !defaultRole) {
    return { rows: [], error: "The file needs a role column with Professor, Dean or Cluster Professor." };
  }
  if (!body.length) return { rows: [], error: "The file has no staff rows under the header." };
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
    })),
  };
}

// Adds `problem` (null when the row is ready) and `programId` for a known program code. Existing emails come from
// profiles; programs are the active programs ({ id, program_code }).
export function checkStaffRows(rows, { existingEmails = [], programs = [] } = {}) {
  const takenEmails = new Set(existingEmails.map((value) => String(value || "").trim().toLowerCase()));
  const programByCode = new Map(programs.map((program) => [String(program.program_code || "").trim().toUpperCase(), program.id]));
  const emailCounts = rows.reduce((counts, row) => {
    if (row.email) counts.set(row.email, (counts.get(row.email) || 0) + 1);
    return counts;
  }, new Map());
  return rows.map((row) => {
    const programId = row.programCode ? programByCode.get(row.programCode) || "" : "";
    let problem = null;
    if (!row.fullName) problem = "Full name is missing";
    else if (!row.email) problem = "Email is missing";
    else if (!EMAIL_PATTERN.test(row.email)) problem = "Email is not valid";
    else if (!row.role) problem = row.roleText ? `Role "${row.roleText}" is not Professor, Dean or Cluster Professor` : "Role is missing";
    else if (row.programCode && !programId) problem = `Program "${row.programCode}" is not an active program`;
    else if (emailCounts.get(row.email) > 1) problem = "Email appears more than once in the file";
    else if (takenEmails.has(row.email)) problem = "Email already has an account";
    return { ...row, programId, problem };
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

export function templateCsv(defaultRole = "Professor") {
  return toCsv([TEMPLATE_HEADERS, ["Juan Dela Cruz", "juan.delacruz@school.edu", defaultRole, "BSIT"]]);
}

// results: Map of rowNumber -> { status: "Created" | "Failed", message }. Rows never sent show as Skipped.
const RESULTS_HEADERS = ["row", "full_name", "email", "role", "program", "result", "details"];
function resultRows(rows, results) {
  return rows.map((row) => {
    const result = results.get(row.rowNumber);
    return [
      row.rowNumber,
      row.fullName,
      row.email,
      row.role || row.roleText,
      row.programCode || "",
      result?.status || "Skipped",
      result?.message || row.problem || "",
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

// Sheet 1 "Staff" is what the upload reads (header plus one example row); sheet 2 explains each column and
// lists the active program codes.
export function templateSheets(defaultRole = "Professor", programs = []) {
  const codes = programs.map((program) => String(program.program_code || "").trim()).filter(Boolean);
  const example = ["Juan Dela Cruz", "juan.delacruz@school.edu", defaultRole, codes[0] || "BSIT"];
  return [
    {
      sheet: "Staff",
      data: [TEMPLATE_HEADERS.map(headerCell), example.map(textCell)],
      columns: [{ width: 28 }, { width: 34 }, { width: 20 }, { width: 14 }],
      stickyRowsCount: 1,
    },
    {
      sheet: "How to fill",
      data: [
        ["Column", "What to type"].map(headerCell),
        ["full_name", "The person's full name. Required."].map(textCell),
        ["email", "A valid email address that has no account yet. Required."].map(textCell),
        ["role", "Professor, Dean, or Cluster Professor. Required."].map(textCell),
        ["program", `Optional. An active program code: ${codes.length ? codes.join(", ") : "see Academic Programs"}.`].map(textCell),
        ["", ""].map(textCell),
        ["Note", "Replace the example row on the Staff sheet, keep the header row, and upload this file as it is. Up to 200 rows."].map(textCell),
      ],
      columns: [{ width: 14 }, { width: 90 }],
    },
  ];
}

export function resultsSheet(rows, results) {
  return {
    sheet: "Results",
    data: [RESULTS_HEADERS.map(headerCell), ...resultRows(rows, results).map((cells) => cells.map(textCell))],
    columns: [{ width: 7 }, { width: 28 }, { width: 34 }, { width: 18 }, { width: 11 }, { width: 11 }, { width: 60 }],
    stickyRowsCount: 1,
  };
}
