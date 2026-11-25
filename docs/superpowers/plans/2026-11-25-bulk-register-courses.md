# Bulk Register Course Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bulk Register can list each student's courses by joining code, so new students are created already enrolled and returning students get enrolled in their new courses.

**Architecture:** File reading, row checks and the template/results workbooks stay pure functions in `src/lib/bulkAccounts.js`. The `create-account` edge function (service role, Admin-only) gains `courseCodes` on `create` and a new `enroll` action; both share one enrollment helper. The Bulk Register modal loads active courses and existing profiles, previews each row as create or enroll, and calls the function one row at a time.

**Tech Stack:** React 18 + Vite, Supabase (Postgres, Deno edge functions), read-excel-file 9.3.14 / write-excel-file 4.1.1, Node `assert` check scripts.

**Spec:** `docs/superpowers/specs/2026-11-25-bulk-register-courses-design.md`

## Global Constraints

- No database migration. The only hosted change is redeploying `create-account` (`npx supabase functions deploy create-account --project-ref bclpbgjpkunphiisbdym --use-api`), and only after Ivan says so.
- No commits, pushes or deploys without Ivan's OK. Never stage CLAUDE.md, docs/handoff/, planning/, output/, .claude/, .playwright-mcp/, supabase/.temp/cli-latest, supabase/local/hosted-reopen-*.sql, reports/, research_notes/.
- Tests on Windows: `$env:NODE_OPTIONS='--require "C:/Users/Ivan/AppData/Local/Temp/claude/250e54c1f3a19f93/3d471d1b-024e-4008-be4b-181b6d080b68/scratchpad/lf-preload.cjs"'; npm test`. Check scripts start with `/* global console */`.
- Courses are named by **joining code** only; only courses with `archived = false` count.
- At most **20** course codes per row; a code longer than **32** characters is an error.
- An unknown or archived code never blocks or rolls back an account: it is skipped and reported.
- An existing email is enrolled only if it is an **Active Student**, and only if the row's student number (when filled) matches the account's.
- Enrollment inserts use `on conflict (course_id, student_id) do nothing` semantics (already-enrolled counts as enrolled).
- Older files without a `courses` column upload exactly as before.

## Review Focus

1. A courses cell typed with semicolons, line breaks or extra spaces (`x7k2qd; M4P9TR`) — should read as two codes, upper-cased. → Task 1 test `splits courses on commas, semicolons and line breaks`.
2. The same code twice in one cell — enrolled once, counted once. → Task 1 test `drops repeated codes`.
3. An Excel cell whose code is all digits (`482913`) arrives as a number — must read as the text code. → Task 1 Excel test `numeric course code cell`.
4. A returning student who is already in one of the listed courses — reported as enrolled, no error, no duplicate row. → Task 2 source check `upsert ... ignoreDuplicates`.
5. An existing email whose student number differs only in case or spaces (`2026-0001 ` vs `2026-0001`) — must count as a match, not a mismatch. → Task 1 test `student number match ignores case and spaces`.

---

### Task 1: Courses column, row checks, template and results (`bulkAccounts.js`)

**Files:**
- Modify: `src/lib/bulkAccounts.js`
- Test: `scripts/check-bulk-accounts.mjs`, `scripts/check-bulk-accounts-excel.mjs`

**Interfaces:**
- Produces:
  - `TEMPLATE_HEADERS = ["full_name", "email", "role", "program", "student_number", "courses"]`
  - `MAX_COURSES_PER_ROW = 20`, `MAX_COURSE_CODE_LENGTH = 32`
  - `splitCourseCodes(text: string): string[]` — split on `,` `;` and line breaks, trim, upper-case, drop empty and repeated codes.
  - `readStaffRows` rows gain `courseCodes: string[]` (header aliases `courses`, `course`, `course_codes`, `course codes`, `joining codes`). The missing-columns error text says `(program, student_number and courses are optional)`.
  - `checkStaffRows(rows, { existingEmails, existingStudentNumbers, programs, existingStudents = [], courses = [] })` where `existingStudents: { email, studentNumber, status }[]` and `courses: { joining_code }[]` (active only). Each returned row adds `mode: "create" | "enroll"`, `knownCodes: string[]`, `unknownCodes: string[]`.
  - `templateSheets(defaultRole, programs, courses = [], professorNames = new Map())` — sheets `["Accounts", "How to fill", "Courses"]`.
  - `resultsSheet(rows, results)` where `results: Map<rowNumber, { status: "Created" | "Enrolled" | "Failed", message: string, enrolled?: string[], skipped?: string[] }>`.

- [ ] **Step 1: Write the failing tests in `scripts/check-bulk-accounts.mjs`**

Update the existing `read.rows` deepEqual to include `courseCodes: []`, the missing-columns regex to the new wording, then add:

```js
// splits courses on commas, semicolons and line breaks
assert.deepEqual(splitCourseCodes(" x7k2qd; M4P9TR,\nab12cd "), ["X7K2QD", "M4P9TR", "AB12CD"]);
// drops repeated codes
assert.deepEqual(splitCourseCodes("X7K2QD, x7k2qd"), ["X7K2QD"]);
assert.deepEqual(readStaffCsv('full_name,email,role,student_number,courses\nMia,mia@x.edu,Student,2026-9,"x7k2qd, m4p9tr"').rows[0].courseCodes, ["X7K2QD", "M4P9TR"]);
assert.deepEqual(readStaffCsv("full_name,email,role\nBen,ben@x.edu,Dean").rows[0].courseCodes, [], "Files without a courses column still read.");

const courses = [{ joining_code: "X7K2QD" }, { joining_code: "M4P9TR" }];
const existingStudents = [
  { email: "old@x.edu", studentNumber: "2026-0001", status: "Active" },
  { email: "off@x.edu", studentNumber: "2026-0002", status: "Deactivated" },
];
const check = (csv) => checkStaffRows(readStaffCsv(`full_name,email,role,student_number,courses\n${csv}`).rows, {
  existingEmails: ["old@x.edu", "off@x.edu", "prof@x.edu"], existingStudentNumbers: ["2026-0001", "2026-0002"], existingStudents, courses,
})[0];
assert.deepEqual(pick(check('New,new@x.edu,Student,2026-5,"X7K2QD, ZZZZZZ"')), { mode: "create", problem: null, knownCodes: ["X7K2QD"], unknownCodes: ["ZZZZZZ"] }, "An unknown code is a warning, not a problem.");
assert.equal(check("Prof,p2@x.edu,Professor,,X7K2QD").problem, "Courses are for students only");
assert.deepEqual(pick(check("Old,old@x.edu,Student,2026-0001,M4P9TR")), { mode: "enroll", problem: null, knownCodes: ["M4P9TR"], unknownCodes: [] });
assert.equal(check("Old,old@x.edu,Student,,M4P9TR").mode, "enroll", "A blank student number is fine for an existing student.");
// student number match ignores case and spaces
assert.equal(check("Old,OLD@x.edu,Student, 2026-0001 ,M4P9TR").problem, null);
assert.equal(check("Old,old@x.edu,Student,2026-9999,M4P9TR").problem, "Student number does not match this account");
assert.equal(check("Off,off@x.edu,Student,2026-0002,M4P9TR").problem, "Account is deactivated");
assert.equal(check("Old,old@x.edu,Student,2026-0001,").problem, "Email already has an account", "An existing student with no courses is still refused.");
assert.equal(check("Prof,prof@x.edu,Student,2026-7,M4P9TR").problem, "Email already has an account", "An existing staff email is refused.");
assert.equal(check(`Many,many@x.edu,Student,2026-8,"${Array.from({ length: 21 }, (_, i) => `C${i}`).join(",")}"`).problem, "List at most 20 courses");
assert.equal(check(`Long,long@x.edu,Student,2026-8,${"A".repeat(33)}`).problem, "A course code is longer than 32 characters");
```

(`pick = ({ mode, problem, knownCodes, unknownCodes }) => ({ mode, problem, knownCodes, unknownCodes })`, defined in the script.)

- [ ] **Step 2: Write the failing tests in `scripts/check-bulk-accounts-excel.mjs`**

```js
const courseRows = [{ id: "c1", joining_code: "X7K2QD", course_code: "IT 101", course_name: "Intro to Computing", section: "2A", year_level: "2", semester: "1st", academic_year: "2026-2027", professor_id: "p1", programs: { program_code: "BSIT" } }];
const withCourses = templateSheets("Dean", programs, courseRows, new Map([["p1", "Ana Reyes"]]));
assert.deepEqual(withCourses.map((sheet) => sheet.sheet), ["Accounts", "How to fill", "Courses"]);
assert.deepEqual(withCourses[2].data[1].map((cell) => cell.value), ["X7K2QD", "IT 101", "Intro to Computing", "2A", "2", "1st", "2026-2027", "BSIT", "Ana Reyes"]);
assert.equal(withCourses[0].data[2].at(-1).value, "X7K2QD", "The student example uses a real active code when there is one.");
// numeric course code cell
assert.deepEqual(readStaffRows([["full_name", "email", "role", "student_number", "courses"], ["Mia", "mia@x.edu", "Student", "2026-9", 482913]]).rows[0].courseCodes, ["482913"]);
```

Update the existing sheet-name assertion to `["Accounts", "How to fill", "Courses"]` and the results header assertion to end with `"result", "details", "courses", "courses_enrolled", "courses_skipped"`; add a results row check: `{ status: "Enrolled", message: "", enrolled: ["M4P9TR"], skipped: ["ZZZZZZ"] }` writes `"Enrolled"`, `"M4P9TR"`, `"ZZZZZZ"` in the last columns.

- [ ] **Step 3: Run the two checks to see them fail**

Run: `node scripts/check-bulk-accounts.mjs; node scripts/check-bulk-accounts-excel.mjs` (with the NODE_OPTIONS above)
Expected: FAIL — `splitCourseCodes` is not exported.

- [ ] **Step 4: Implement in `src/lib/bulkAccounts.js`**

- `splitCourseCodes`, the `courseCodes` field and alias, the new constants and header, as in Interfaces.
- `checkStaffRows`: keep every existing check in its current order, with these changes. Courses filled on a staff row → `"Courses are for students only"` (after the role checks). Too many codes / too-long code problems as tested. An email in `existingEmails` becomes `mode: "enroll"` instead of a problem only when it is in `existingStudents`, the row is a Student with at least one code, the account `status === "Active"` (else `"Account is deactivated"`), and a filled student number matches after `trim().toLowerCase()` (else `"Student number does not match this account"`). Enroll rows skip the "student number is missing" and "student number already has an account" checks (decide `mode` before those checks run). `knownCodes`/`unknownCodes` split `courseCodes` against `courses`.
- `templateSheets`: Accounts columns gain a `courses` column (width 22); the staff example has `""`; the student example uses `courses[0]?.joining_code || "X7K2QD"`. "How to fill" gains a `courses` line: "Students only, optional. Joining codes from the Courses sheet, separated by commas. For a student who already has an account, the row enrolls that account in these courses." The Courses sheet header is `["joining_code", "course_code", "course_name", "section", "year_level", "semester", "academic_year", "program", "professor"]`, one row per given course, professor from `professorNames.get(course.professor_id) || "Unassigned"`, sticky header.
- `resultRows`/`RESULTS_HEADERS`: add `courses` (the row's codes joined with `", "`), `courses_enrolled`, `courses_skipped`. Update `templateCsv` and `EXAMPLE_STUDENT` to the six-column header (staff example `""` in courses).

- [ ] **Step 5: Run the two checks to see them pass**

Run: `node scripts/check-bulk-accounts.mjs; node scripts/check-bulk-accounts-excel.mjs`
Expected: both print their "passed" line.

- [ ] **Step 6: Commit (only with Ivan's OK)**

```bash
git add src/lib/bulkAccounts.js scripts/check-bulk-accounts.mjs scripts/check-bulk-accounts-excel.mjs
git commit -m "feat: courses column and Courses sheet for Bulk Register"
```

---

### Task 2: `create-account` enrolls students

**Files:**
- Modify: `supabase/functions/create-account/index.ts`
- Create: `scripts/check-bulk-course-enrollment.mjs`
- Modify: `package.json` (add `node scripts/check-bulk-course-enrollment.mjs && ` to the test command next to the other bulk checks)

**Interfaces:**
- Produces (HTTP, body JSON):
  - `create` accepts `courseCodes?: string[]`. Staff with any code → 400 `"Courses are for students only."`. Response `{ profile, enrolled: string[], skipped: string[] }`.
  - `enroll`: `{ action: "enroll", email: string, courseCodes: string[], studentNumber?: string }` → `{ profile: { id, full_name, email }, enrolled, skipped }`. Errors: no codes → 400 `"List at least one course."`; no account → 404 `"No account uses the email <email>."`; not a Student → 400 `"<email> is not a student account."`; not Active → 400 `"<email> is deactivated."`; number mismatch → 400 `"Student number <n> does not match this account."`.
  - Internal: `readCourseCodes(value: unknown): { codes: string[], error: string }` (array or string; upper-case, trim, dedupe; >20 → `"List at most 20 courses."`; >32 chars → `"A course code is longer than 32 characters."`) and `enrollInCourses(adminClient, studentId: string, codes: string[]): Promise<{ enrolled: string[], skipped: string[] }>`.

- [ ] **Step 1: Write the failing source checks in `scripts/check-bulk-course-enrollment.mjs`**

```js
/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fn = readFileSync("supabase/functions/create-account/index.ts", "utf8");
assert.match(fn, /function readCourseCodes\(/);
assert.match(fn, /codes\.length > 20[\s\S]*?"List at most 20 courses\."/);
assert.match(fn, /\.length > 32[\s\S]*?"A course code is longer than 32 characters\."/);
assert.match(fn, /async function enrollInCourses\(/);
assert.match(fn, /\.from\("courses"\)[\s\S]*?\.in\("joining_code", codes\)[\s\S]*?\.eq\("archived", false\)/, "Only active courses, matched by joining code.");
// upsert ... ignoreDuplicates: an already-enrolled course is not an error and adds no row
assert.match(fn, /\.from\("course_enrollments"\)[\s\S]*?\.upsert\([\s\S]*?onConflict: "course_id,student_id", ignoreDuplicates: true/);
const createStart = fn.indexOf('if (action === "create")');
const enrollStart = fn.indexOf('if (action === "enroll")');
assert.ok(enrollStart > 0, "There is an enroll action.");
const createBlock = fn.slice(createStart, fn.indexOf('if (action === "assign-program")'));
assert.match(createBlock, /!isStudent && courseCodes\.codes\.length[\s\S]*?"Courses are for students only\."/);
assert.ok(createBlock.indexOf("enrollInCourses(") > createBlock.indexOf('action: "Account Created"'), "Enrolling happens after the account and its log entry exist.");
assert.match(createBlock, /return json\(\{ profile, enrolled, skipped \}\)/);
const enrollBlock = fn.slice(enrollStart);
assert.match(enrollBlock, /\.eq\("email", email\)/);
assert.match(enrollBlock, /role !== "Student"[\s\S]*?is not a student account\./);
assert.match(enrollBlock, /status !== "Active"[\s\S]*?is deactivated\./);
assert.match(enrollBlock, /does not match this account\./);
assert.match(fn, /action: "Student Enrolled"/);
assert.ok(fn.indexOf('if (action === "enroll")') > fn.indexOf("adminRoles.has(caller.role)"), "enroll is behind the Admin check.");

console.log("Bulk course enrollment checks passed.");
```

- [ ] **Step 2: Run it to see it fail**

Run: `node scripts/check-bulk-course-enrollment.mjs`
Expected: FAIL at `function readCourseCodes\(`.

- [ ] **Step 3: Implement in `index.ts`**

- `readCourseCodes` and `enrollInCourses` as in Interfaces; `readCourseCodes` tests `codes.length > 20` and `code.length > 32`. `enrollInCourses` runs `.from("courses").select("id, joining_code").in("joining_code", codes).eq("archived", false)`, upserts `{ course_id, student_id }` rows with `{ onConflict: "course_id,student_id", ignoreDuplicates: true }`, returns found codes as `enrolled` and the rest as `skipped`; if the upsert errors, every code is returned as `skipped` (never thrown).
- `create`: parse `courseCodes` with the other inputs (return its error as 400); reject staff with codes; after the existing "Account Created" audit, `const { enrolled, skipped } = courseCodes.codes.length ? await enrollInCourses(...) : { enrolled: [], skipped: [] }`; if `enrolled.length`, write audit `eventType: "course.enrolled"`, `action: "Student Enrolled"`, `description: "An admin enrolled a student in courses."`, `entityType: "account"`, `targetUserId`, `metadata: { courses: enrolled }`. Return `{ profile, enrolled, skipped }`.
- `enroll`: new block before `assign-program`, errors as in Interfaces, same audit entry; returns `{ profile: { id, full_name, email }, enrolled, skipped }`.
- Update the header comment to mention course enrollment. Add the new check to `package.json`.

- [ ] **Step 4: Run it to see it pass, plus the existing account checks**

Run: `node scripts/check-bulk-course-enrollment.mjs; node scripts/check-account-security.mjs`
Expected: both print "passed".

- [ ] **Step 5: Commit (only with Ivan's OK)**

```bash
git add supabase/functions/create-account/index.ts scripts/check-bulk-course-enrollment.mjs package.json
git commit -m "feat: create-account enrolls students in courses"
```

---

### Task 3: Bulk Register screen and People page

**Files:**
- Modify: `src/components/admin/BulkRegisterModal.jsx`, `src/pages/People.jsx`
- Test: `scripts/check-bulk-course-enrollment.mjs` (append)

**Interfaces:**
- Consumes: Task 1 `checkStaffRows` options and row fields, `templateSheets(defaultRole, programs, courses, professorNames)`, `resultsSheet` result shape; Task 2 HTTP shapes.
- Produces:
  - People.jsx `createAccount({ role, fullName, email, password, programId, studentNumber, courseCodes = [] })` now returns `{ enrolled: string[], skipped: string[] }` (sends `courseCodes` only for students). Demo mode (no Supabase) returns `{ enrolled: courseCodes, skipped: [] }`.
  - People.jsx `enrollStudent({ email, courseCodes, studentNumber }) → Promise<{ enrolled, skipped }>` via `callAccountFunction({ action: "enroll", ... })`; demo mode returns `{ enrolled: courseCodes, skipped: [] }`.
  - BulkRegisterModal prop `enrollStudent` (required alongside `createAccount`).

- [ ] **Step 1: Append failing source checks**

```js
const modal = readFileSync("src/components/admin/BulkRegisterModal.jsx", "utf8");
assert.match(modal, /select\("id, email, role, status, full_name, student_number", options\)/, "Existing accounts are read with role and status.");
assert.match(modal, /from\("courses"\)[\s\S]*?\.eq\("archived", false\)/, "Active courses are loaded for checks and the template.");
assert.match(modal, /existingStudents[\s\S]*?courses:/, "Rows are checked against existing students and courses.");
assert.match(modal, /row\.mode === "enroll"\s*\?\s*await enrollStudent\(/);
assert.match(modal, /courseCodes: row\.knownCodes/, "Only known codes are sent.");
assert.match(modal, /templateSheets\(defaultRole \|\| "Professor", programs, activeCourses, professorNames\)/);
const people = readFileSync("src/pages/People.jsx", "utf8");
assert.match(people, /async function enrollStudent\(/);
assert.match(people, /action: "enroll"/);
assert.match(people, /enrollStudent=\{enrollStudent\}/);
```

- [ ] **Step 2: Run it to see it fail**

Run: `node scripts/check-bulk-course-enrollment.mjs`
Expected: FAIL at the profiles select assertion.

- [ ] **Step 3: Implement**

- Modal loading: the profiles read becomes `select("id, email, role, status, full_name, student_number", options)`; `existing` gains `students: { email, studentNumber, status }[]` (role Student) and `professorNames: Map<id, full_name>`. In the same effect, load `supabase.from("courses").select("id, joining_code, course_code, course_name, section, year_level, semester, academic_year, professor_id, programs(program_code)").eq("archived", false).order("course_code")` into `activeCourses` (on error: toast and `[]`). Demo mode: `activeCourses = []`.
- `checkStaffRows(..., { ...existing options, existingStudents: existing.students, courses: activeCourses })`.
- Template button: `templateSheets(defaultRole || "Professor", programs, activeCourses, professorNames)`, with `const professorNames = existing?.professorNames || new Map();` in the component body.
- Table: add a "Courses" column (width 14%; shrink Email to 18% and Full Name to 16%) showing `knownCodes` joined, with unknown codes in `bulk-register-problem` text as `"<code> not found"`. Ready badge reads "Will enroll" for `mode === "enroll"`.
- `createAll`: per row, `const outcome = row.mode === "enroll" ? await enrollStudent({ email: row.email, courseCodes: row.knownCodes, studentNumber: row.studentNumber }) : await createAccount({ ...existing args, courseCodes: row.knownCodes })`. Store `{ status: row.mode === "enroll" ? "Enrolled" : "Created", message, enrolled, skipped: [...row.unknownCodes, ...outcome.skipped] }`. Result badge: "Created", "Created · 2 courses", or "Enrolled in 2"; skipped codes shown under it. Summary badges and toasts count created and enrolled separately ("3 accounts created", "2 students enrolled"); the button reads "Create / enroll N" when any row is enroll mode.
- Header copy: mention that students can be enrolled in courses by joining code.
- People.jsx: `createAccount` returns `{ enrolled: data.enrolled || [], skipped: data.skipped || [] }`; add `enrollStudent`; pass `enrollStudent={enrollStudent}` to the modal; invalidate `["admin-accounts"]` after enroll too.

- [ ] **Step 4: Run all checks, lint and build**

Run: `npm test` (NODE_OPTIONS as above); `npx eslint src/components/admin/BulkRegisterModal.jsx src/pages/People.jsx src/lib/bulkAccounts.js scripts/check-bulk-course-enrollment.mjs scripts/check-bulk-accounts.mjs scripts/check-bulk-accounts-excel.mjs`; `npm run build`
Expected: every check prints "passed", eslint prints nothing, build ends with "built in".

- [ ] **Step 5: Look at it**

Open the app without Supabase settings (demo mode) through the static/preview setup used in this project, sign in as the demo Admin, open Create Account → Bulk Register, download the template (three sheets, Courses sheet present), upload a file with a new student with codes, an existing student and a staff row with codes; confirm the preview text matches Task 1's table and the results file has the three course columns. Screenshot for Ivan.

- [ ] **Step 6: Commit (only with Ivan's OK)**

```bash
git add src/components/admin/BulkRegisterModal.jsx src/pages/People.jsx scripts/check-bulk-course-enrollment.mjs
git commit -m "feat: Bulk Register enrolls new and returning students in courses"
```

---

### Task 4: Go live (only when Ivan says "go live")

- [ ] **Step 1:** `npx supabase functions deploy create-account --project-ref bclpbgjpkunphiisbdym --use-api`; then `npx supabase functions download create-account --project-ref bclpbgjpkunphiisbdym` into the scratchpad and confirm it contains `action === "enroll"`.
- [ ] **Step 2:** `git push origin HEAD:main`; wait until the live bundle's BulkRegisterModal chunk contains `Will enroll`.
- [ ] **Step 3:** Ask Ivan for a live smoke test (or his OK for one): one test student with one real joining code, then sign in as that student and see the course on the dashboard.
