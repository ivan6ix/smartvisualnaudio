# Bulk Register: enroll students in courses

Date: 2026-11-25. Size: small feature. Status: awaiting approval.

## Why

Panelist recommendation. Students no longer create their own accounts (self-registration was removed on
2026-11-25), so the admin's Bulk Register is how students arrive. When a student signs in for the first time,
their courses should already be on the dashboard — no joining codes to type.

## Goals

- The Bulk Register sheet can list each student's courses; uploading it creates the account and enrolls the
  student in those courses in one step.
- The same sheet works for returning students: if the email already has a Student account, the upload enrolls
  that account in the listed courses and leaves the account itself untouched.
- The admin can see every active course's joining code inside the template, so filling the sheet needs no
  other screen.

## Non-goals

- No change to how students join by code themselves (`join_course_by_code` stays as it is).
- No professor-side roster import, no removing students from courses, no moving students between sections.
- No editing of an existing account's name, program or student number through the upload.

## Anti-goals

- An account must never be lost because a course code was mistyped.
- A wrong email must not silently enroll somebody else's account (see the student-number check below).

## Approaches considered

- **A. Extend the `create-account` edge function (chosen by Ivan).** It already creates every Bulk Register
  account, checks the caller is an Admin, and writes the activity log. Create also takes course codes; a new
  `enroll` action handles existing students. One function redeploy, no database migration, one server call
  per row.
- **B. New security-definer SQL function called from the browser after each create.** Needs a hosted
  migration, and enrolling becomes a second browser step, so a closed tab could leave an account without its
  courses.
- **C. Professor roster import.** Dropped: does not give students ready courses at first sign-in.

## Decided with Ivan

- Courses are named in the sheet by **joining code** (exact, never ambiguous).
- The template gains a **Courses** sheet listing every active course with its joining code.
- An email that already has a Student account is **enrolled, not refused**; the account is left untouched.

## Design

### Template and file reading (`src/lib/bulkAccounts.js`)

- New optional last column `courses` on the "Accounts" sheet (`TEMPLATE_HEADERS` gains `courses`). Several
  codes go in one cell separated by commas, e.g. `X7K2QD, M4P9TR`; codes are trimmed and upper-cased, and
  repeats are removed. The student example row gets a sample code. CSV uploads read the same column.
- New "Courses" sheet, built when the template is downloaded from the admin's current course list: joining
  code, course code, course name, section, year level, semester, academic year, program, professor. Only
  courses that are not archived. The Read Me sheet gains one line explaining the column.
- Older files without a `courses` column still upload exactly as today.

### Checking rows before upload (`checkStaffRows`)

Uses the active courses already loaded for the template. For each row:

| Row | Result in the preview |
|---|---|
| New email, any role, no courses | Ready (as today) |
| New email, Student, courses listed | Ready — "Create + enroll in N courses" |
| Staff row with courses filled | Problem: "Courses are for students only" |
| Existing email that is a Student, courses listed | Ready — "Enroll existing account in N courses" |
| Existing email that is a Student, no courses | Problem: "Email already has an account" (as today) |
| Existing email that is staff | Problem: "Email already has an account" (as today) |
| Existing Student, student number filled and different from the account's | Problem: "Student number does not match this account" |
| Existing Student who is deactivated | Problem: "Account is deactivated" |
| A listed code not found among active courses | Not blocking: shown as a warning, e.g. "Course X7K2QQ not found — will be skipped" |

The existing check "student number already has an account" still applies to new students.

### Server (`supabase/functions/create-account/index.ts`)

- `create` accepts optional `courseCodes: string[]` (students only; rejected for staff). After the account is
  created, it looks up non-archived courses with those joining codes and inserts `course_enrollments`
  (`on conflict (course_id, student_id) do nothing`). Codes not found are returned, not raised. An enrollment
  failure never rolls back the account; the response says which codes were enrolled and which were skipped.
- New `enroll` action: `{ email, courseCodes, studentNumber? }`. Admin only. Finds the profile by email; must be
  an Active Student; if `studentNumber` is given it must match. Enrolls as above and returns enrolled/skipped
  codes. Already-enrolled courses count as enrolled (no duplicate rows).
- Activity log: one "Student Enrolled" entry per account listing the course codes, alongside the existing
  "Account Created" entry.
- Limits: at most 20 course codes per row; codes longer than 32 characters are rejected.

### Bulk Register screen (`src/components/admin/BulkRegisterModal.jsx`)

- Preview shows a Courses column (codes, with unknown ones marked).
- The Create button calls `create` for new rows and `enroll` for existing-student rows, one row at a time as
  today. Result per row: "Created", "Created · enrolled in 2", "Enrolled in 2 (existing account)", plus any
  skipped codes. The downloadable results file gains `courses enrolled` and `courses skipped` columns.
- Success toast counts accounts created and students enrolled separately.

### Checks

- Extend `scripts/check-bulk-accounts.mjs` / `check-bulk-accounts-excel.mjs`: courses column parsed, Courses
  sheet built, every row case in the table above, older files without the column still read.
- Function source checks: `courseCodes` only for students, `enroll` requires Admin and an Active Student, the
  student-number match, `on conflict do nothing`, account kept when enrollment fails.

## Left to the builder

- Exact wording of messages and the Courses sheet column order.
- Whether the course lookup for the preview reuses an existing query or adds a small one.

## Rollout

Local tests, lint, build; then, with Ivan's go-ahead, redeploy `create-account` and push. No database
migration. The paper's Bulk Register descriptions (SOP 1.2, Scope, FR-ADM-02, Table 17/18) will need a line
about course enrollment when the paper is updated.
