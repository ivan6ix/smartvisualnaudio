// Bulk staff registration: reads a CSV of staff, checks each row before anything is created, and builds the
// template and results files. Accounts are created one at a time through the create-account function, so each
// one gets the same checks and audit log entry as a single Create Account.

export const STAFF_ROLES = ["Professor", "Dean", "Cluster Professor"];
export const MAX_ROWS = 200;
export const TEMPLATE_HEADERS = ["full_name", "email", "employee_number", "role"];

const HEADER_ALIASES = {
  fullName: ["full_name", "full name", "name"],
  email: ["email", "email address"],
  employeeNumber: ["employee_number", "employee number", "employee no", "employee no."],
  role: ["role", "account type"],
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

// Rows keep their spreadsheet row number (the header is row 1) so problems can be found in the file.
export function readStaffCsv(text, { defaultRole = "" } = {}) {
  const [header = [], ...body] = parseCsv(text);
  const columns = {};
  header.forEach((name, index) => {
    const key = Object.keys(HEADER_ALIASES).find((field) => HEADER_ALIASES[field].includes(name.trim().toLowerCase()));
    if (key && columns[key] === undefined) columns[key] = index;
  });
  const missing = ["fullName", "email", "employeeNumber"].filter((field) => columns[field] === undefined);
  if (!header.length || missing.length) {
    return { rows: [], error: `The file needs these columns: ${TEMPLATE_HEADERS.join(", ")}. Download the template to start from.` };
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
      employeeNumber: cell(cells, "employeeNumber"),
      roleText: cell(cells, "role"),
      role: normalizeRole(cell(cells, "role"), defaultRole),
    })),
  };
}

// Adds `problem` (null when the row is ready). Existing values come from profiles, already lowercased for email.
export function checkStaffRows(rows, { existingEmails = [], existingEmployeeNumbers = [] } = {}) {
  const takenEmails = new Set(existingEmails.map((value) => String(value || "").trim().toLowerCase()));
  const takenNumbers = new Set(existingEmployeeNumbers.map((value) => String(value || "").trim().toLowerCase()));
  const count = (key) => rows.reduce((counts, row) => {
    const value = row[key].toLowerCase();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  }, new Map());
  const emailCounts = count("email");
  const numberCounts = count("employeeNumber");
  return rows.map((row) => {
    const number = row.employeeNumber.toLowerCase();
    let problem = null;
    if (!row.fullName) problem = "Full name is missing";
    else if (!row.email) problem = "Email is missing";
    else if (!EMAIL_PATTERN.test(row.email)) problem = "Email is not valid";
    else if (!row.employeeNumber) problem = "Employee number is missing";
    else if (!row.role) problem = row.roleText ? `Role "${row.roleText}" is not Professor, Dean or Cluster Professor` : "Role is missing";
    else if (emailCounts.get(row.email) > 1) problem = "Email appears more than once in the file";
    else if (numberCounts.get(number) > 1) problem = "Employee number appears more than once in the file";
    else if (takenEmails.has(row.email)) problem = "Email already has an account";
    else if (takenNumbers.has(number)) problem = "Employee number already has an account";
    return { ...row, problem };
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
  return toCsv([TEMPLATE_HEADERS, ["Juan Dela Cruz", "juan.delacruz@school.edu", "EMP-0001", defaultRole]]);
}

// results: Map of rowNumber -> { status: "Created" | "Failed", message }. Rows never sent show as Skipped.
export function resultsCsv(rows, results) {
  return toCsv([
    ["row", "full_name", "email", "employee_number", "role", "result", "details"],
    ...rows.map((row) => {
      const result = results.get(row.rowNumber);
      return [
        row.rowNumber,
        row.fullName,
        row.email,
        row.employeeNumber,
        row.role || row.roleText,
        result?.status || "Skipped",
        result?.message || row.problem || "",
      ];
    }),
  ]);
}
