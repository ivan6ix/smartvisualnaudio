import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FiDownload, FiUpload, FiUserPlus, FiX } from "react-icons/fi";
import { Badge, Button, Field, Table } from "../ui";
import { checkStaffRows, MAX_ROWS, readStaffCsv, readStaffRows, resultsSheet, templateSheets } from "../../lib/bulkAccounts";
import { fetchAllRows } from "../../lib/fetchAllRows";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

// The Excel libraries load only when a workbook is written or read, so the rest of the app stays small.
async function downloadWorkbook(sheets, fileName) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  await writeExcelFile(sheets).toFile(fileName);
}

const isExcelFile = (file) => /\.xlsx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function readUploadedStaff(file, defaultRole) {
  if (isExcelFile(file)) {
    const { readSheet } = await import("read-excel-file/browser");
    return readStaffRows(await readSheet(file), { defaultRole });
  }
  return readStaffCsv(await file.text(), { defaultRole });
}

// defaultRole is the page's role ("" on Create Account, where the file must say the role).
// programs are the active programs ({ id, program_code }) that the optional program column may name.
// createAccount({ role, fullName, email, password, programId, studentNumber, courseCodes }) creates one account,
// enrolls a student in the courses, and returns { enrolled, skipped } (course codes), or throws.
// enrollStudent({ email, courseCodes, studentNumber }) enrolls a student who already has an account and returns
// { enrolled, skipped }, or throws. Staff and Student accounts can be registered from the same file.
export default function BulkRegisterModal({ defaultRole = "", existingAccounts = [], programs = [], createAccount, enrollStudent, onClose }) {
  const [existing, setExisting] = useState(hasSupabaseConfig ? null : {
    emails: existingAccounts.map((account) => account.email),
    studentNumbers: [],
    students: [],
    professorNames: new Map(),
  });
  const [activeCourses, setActiveCourses] = useState([]);
  const [loadError, setLoadError] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileRows, setFileRows] = useState([]);
  const [fileError, setFileError] = useState("");
  const [password, setPassword] = useState("123456");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);

  useEffect(() => {
    if (!hasSupabaseConfig) return;
    let active = true;
    // Every account is read (the API returns at most 1000 rows per request), so no duplicate slips through. Students
    // already in the system can be enrolled in more courses; professors' names fill the template's Courses sheet.
    // The active courses are read in the same step, so rows are only checked once both are known. If either read
    // fails, the upload stays blocked: checking against an empty list would treat every account as new and every
    // course code as unknown.
    Promise.all([
      fetchAllRows((options) => supabase.from("profiles").select("id, email, role, status, full_name, student_number", options).order("id")),
      fetchAllRows((options) => supabase
        .from("courses")
        .select("id, joining_code, course_code, course_name, section, year_level, semester, academic_year, professor_id, programs(program_code)", options)
        .eq("archived", false)
        .order("course_code")
        .order("id")),
    ]).then(([{ data, error }, { data: courseRows, error: coursesError }]) => {
      if (!active) return;
      if (error || coursesError) {
        const message = (error || coursesError).message;
        toast.error(message);
        setLoadError(`Accounts and courses could not be loaded (${message}). Close this window and try again.`);
        return;
      }
      setActiveCourses(courseRows || []);
      const profiles = data || [];
      setExisting({
        emails: profiles.map((profile) => profile.email),
        studentNumbers: profiles.map((profile) => profile.student_number).filter(Boolean),
        students: profiles
          .filter((profile) => profile.role === "Student")
          .map((profile) => ({ email: profile.email, studentNumber: profile.student_number, status: profile.status, fullName: profile.full_name })),
        professorNames: new Map(profiles.map((profile) => [profile.id, profile.full_name || profile.email])),
      });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !running) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, running]);

  const rows = useMemo(() => (existing ? checkStaffRows(fileRows, {
    existingEmails: existing.emails,
    existingStudentNumbers: existing.studentNumbers,
    programs,
    existingStudents: existing.students,
    courses: activeCourses,
  }) : []), [activeCourses, existing, fileRows, programs]);
  const ready = rows.filter((row) => !row.problem);
  const enrollCount = ready.filter((row) => row.mode === "enroll").length;
  const professorNames = existing?.professorNames || new Map();
  const countResults = (status) => (results ? [...results.values()].filter((result) => result.status === status).length : 0);
  const created = countResults("Created");
  const enrolled = countResults("Enrolled");
  const failed = countResults("Failed");

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    let read;
    try {
      read = await readUploadedStaff(file, defaultRole);
    } catch {
      read = { rows: [], error: "The file could not be read. Upload the Excel template (.xlsx) or a CSV file." };
    }
    setFileName(file.name);
    setFileRows(read.rows);
    setFileError(read.error);
    setResults(null);
  }

  async function saveWorkbook(sheets, fileName) {
    try {
      await downloadWorkbook(sheets, fileName);
    } catch (error) {
      toast.error(error.message || "The file could not be created.");
    }
  }

  async function createAll() {
    if (password.length < 6) {
      toast.error("The default password needs at least 6 characters.");
      return;
    }
    setRunning(true);
    setProgress(0);
    setResults(new Map());
    const nextResults = new Map();
    for (const row of ready) {
      try {
        // Only codes of active courses are sent; the others were shown as skipped before the upload.
        const outcome = row.mode === "enroll"
          ? await enrollStudent({ email: row.email, courseCodes: row.knownCodes, studentNumber: row.studentNumber })
          : await createAccount({ role: row.role, fullName: row.fullName, email: row.email, password, programId: row.programId, studentNumber: row.studentNumber, courseCodes: row.knownCodes });
        nextResults.set(row.rowNumber, {
          status: row.mode === "enroll" ? "Enrolled" : "Created",
          message: "",
          enrolled: outcome?.enrolled || [],
          skipped: [...row.unknownCodes, ...(outcome?.skipped || [])],
        });
      } catch (error) {
        nextResults.set(row.rowNumber, { status: "Failed", message: error.message || (row.mode === "enroll" ? "The student was not enrolled." : "Account was not created.") });
      }
      setProgress((count) => count + 1);
      setResults(new Map(nextResults));
    }
    setRunning(false);
    const outcomes = [...nextResults.values()];
    const createdCount = outcomes.filter((result) => result.status === "Created").length;
    const enrolledCount = outcomes.filter((result) => result.status === "Enrolled").length;
    const failedCount = outcomes.filter((result) => result.status === "Failed").length;
    if (createdCount) toast.success(`${createdCount} account${createdCount === 1 ? "" : "s"} created with default password ${password}. Each user sets their own at first sign-in.`);
    if (enrolledCount) toast.success(`${enrolledCount} existing student${enrolledCount === 1 ? "" : "s"} enrolled in courses.`);
    if (failedCount) toast.error(`${failedCount} row${failedCount === 1 ? "" : "s"} could not be completed. See the results.`);
  }

  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

  function resultFor(row) {
    const result = results?.get(row.rowNumber);
    if (result?.status === "Failed") return <span className="bulk-register-problem">{result.message}</span>;
    if (result?.status === "Created" || result?.status === "Enrolled") {
      const count = result.enrolled?.length || 0;
      const label = result.status === "Enrolled" ? `Enrolled in ${plural(count, "course")}` : count ? `Created · ${plural(count, "course")}` : "Created";
      return (
        <div className="bulk-register-stack">
          <Badge tone="success">{label}</Badge>
          {result.skipped?.length ? <span className="bulk-register-problem">Skipped: {result.skipped.join(", ")}</span> : null}
        </div>
      );
    }
    if (row.problem) return <span className="bulk-register-problem">{row.problem}</span>;
    return <Badge tone="blue">{running ? "Waiting" : row.mode === "enroll" ? `Will enroll ${row.matchedName}` : "Ready"}</Badge>;
  }

  function coursesFor(row) {
    if (!row.courseCodes?.length) return "-";
    return (
      <div className="bulk-register-stack">
        {row.knownCodes.length ? <span>{row.knownCodes.join(", ")}</span> : null}
        {row.unknownCodes.map((code) => <span className="bulk-register-problem" key={code}>{code} not found</span>)}
      </div>
    );
  }

  const columns = [
    { key: "rowNumber", label: "Row", width: "7%" },
    { key: "fullName", label: "Full Name", width: "15%" },
    { key: "email", label: "Email", width: "17%" },
    { key: "role", label: "Role", width: "11%", render: (row) => row.role || row.roleText || "-" },
    { key: "programCode", label: "Program", width: "10%", render: (row) => row.programCode || "-" },
    { key: "studentNumber", label: "Student No.", width: "10%", render: (row) => row.studentNumber || "-" },
    { key: "courses", label: "Courses", width: "14%", render: coursesFor },
    { key: "check", label: "Check", width: "16%", render: resultFor },
  ];

  return (
    <div className="modal-backdrop account-modal-backdrop" onClick={running ? undefined : onClose} role="presentation">
      <section aria-labelledby="bulk-register-title" aria-modal="true" className="card modal account-create-modal bulk-register-modal" onClick={(event) => event.stopPropagation()} role="dialog">
        <div className="account-modal-header">
          <div>
            <h2 id="bulk-register-title">Bulk Register {defaultRole ? `${defaultRole}s` : "Accounts"}</h2>
            <p>Create {defaultRole ? `${defaultRole.toLowerCase()}` : "professor, dean, cluster professor, and student"} accounts from an Excel (.xlsx) or CSV file of up to {MAX_ROWS} rows. Students can also be enrolled in courses by joining code, including students who already have an account.</p>
          </div>
          <button aria-label="Close bulk register" disabled={running} onClick={onClose} type="button"><FiX /></button>
        </div>

        <div className="bulk-register-setup">
          <div className="bulk-register-file">
            <label className={`btn btn-light ${running || !existing ? "is-disabled" : ""}`}>
              <FiUpload /> {fileName ? "Choose another file" : "Choose Excel or CSV file"}
              <input accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={running || !existing} onChange={chooseFile} type="file" />
            </label>
            <p>{!existing ? (loadError ? "Upload is unavailable." : "Checking existing accounts and courses...") : fileName ? `${fileName} · ${fileRows.length} row${fileRows.length === 1 ? "" : "s"}` : "Columns: full_name, email, role, and optional program, student_number and courses."}</p>
            <button className="bulk-register-template" onClick={() => saveWorkbook(templateSheets(defaultRole || "Professor", programs, activeCourses, professorNames), "staff-template.xlsx")} type="button">
              <FiDownload /> Download template
            </button>
          </div>
          <Field disabled={running} label="Default Password for This Batch" minLength={6} onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        </div>

        {loadError ? <p className="bulk-register-error" role="alert">{loadError}</p> : null}
        {fileError ? <p className="bulk-register-error" role="alert">{fileError}</p> : null}

        {rows.length ? (
          <>
            <div aria-live="polite" className="bulk-register-summary">
              {results ? (
                <>
                  <Badge tone="success">{created} created</Badge>
                  {enrolled ? <Badge tone="success">{enrolled} enrolled</Badge> : null}
                  {failed ? <Badge tone="danger">{failed} failed</Badge> : null}
                  {rows.length - ready.length ? <Badge tone="warn">{rows.length - ready.length} skipped</Badge> : null}
                  {running ? <span>Working on {Math.min(progress + 1, ready.length)} of {ready.length}...</span> : null}
                </>
              ) : (
                <>
                  <Badge tone="success">{ready.length} ready</Badge>
                  {enrollCount ? <Badge tone="blue">{enrollCount} existing to enroll</Badge> : null}
                  {rows.length - ready.length ? <Badge tone="danger">{rows.length - ready.length} need fixing</Badge> : null}
                </>
              )}
            </div>
            <Table className="bulk-register-table" columns={columns} rows={rows.map((row) => ({ ...row, id: row.rowNumber }))} />
          </>
        ) : null}

        <div className="account-modal-actions">
          {results && !running ? (
            <Button onClick={() => saveWorkbook([resultsSheet(rows, results)], "staff-registration-results.xlsx")} type="button" variant="light"><FiDownload /> Download results</Button>
          ) : null}
          <Button disabled={running} onClick={onClose} type="button" variant="light">{results ? "Close" : "Cancel"}</Button>
          {!results || running ? (
            <Button disabled={running || !ready.length} onClick={createAll} type="button">
              <FiUserPlus /> {running ? "Working..." : enrollCount ? `Create / enroll ${ready.length}` : `Create ${ready.length} account${ready.length === 1 ? "" : "s"}`}
            </Button>
          ) : null}
        </div>
        {ready.length < rows.length && !results ? <p className="bulk-register-note">Rows that need fixing are skipped. Fix them in the file and upload it again to add them later.</p> : null}
      </section>
    </div>
  );
}
