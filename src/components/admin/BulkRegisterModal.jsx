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
// createAccount({ role, fullName, email, password, programId, studentNumber }) creates one account or throws.
// Staff and Student accounts can be registered from the same file.
export default function BulkRegisterModal({ defaultRole = "", existingAccounts = [], programs = [], createAccount, onClose }) {
  const [existing, setExisting] = useState(hasSupabaseConfig ? null : {
    emails: existingAccounts.map((account) => account.email),
    studentNumbers: [],
  });
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
    // Every account is read (the API returns at most 1000 rows per request), so no duplicate slips through.
    fetchAllRows((options) => supabase.from("profiles").select("id, email, student_number", options).order("id")).then(({ data, error }) => {
      if (!active) return;
      if (error) {
        toast.error(error.message);
        setExisting({ emails: [], studentNumbers: [] });
        return;
      }
      setExisting({
        emails: (data || []).map((profile) => profile.email),
        studentNumbers: (data || []).map((profile) => profile.student_number).filter(Boolean),
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
  }) : []), [existing, fileRows, programs]);
  const ready = rows.filter((row) => !row.problem);
  const created = results ? [...results.values()].filter((result) => result.status === "Created").length : 0;

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
        await createAccount({ role: row.role, fullName: row.fullName, email: row.email, password, programId: row.programId, studentNumber: row.studentNumber });
        nextResults.set(row.rowNumber, { status: "Created", message: "" });
      } catch (error) {
        nextResults.set(row.rowNumber, { status: "Failed", message: error.message || "Account was not created." });
      }
      setProgress((count) => count + 1);
      setResults(new Map(nextResults));
    }
    setRunning(false);
    const createdCount = [...nextResults.values()].filter((result) => result.status === "Created").length;
    if (createdCount) toast.success(`${createdCount} account${createdCount === 1 ? "" : "s"} created with default password ${password}. Each user sets their own at first sign-in.`);
    if (createdCount < ready.length) toast.error(`${ready.length - createdCount} account${ready.length - createdCount === 1 ? "" : "s"} could not be created. See the results.`);
  }

  function resultFor(row) {
    const result = results?.get(row.rowNumber);
    if (result?.status === "Created") return <Badge tone="success">Created</Badge>;
    if (result?.status === "Failed") return <span className="bulk-register-problem">{result.message}</span>;
    if (row.problem) return <span className="bulk-register-problem">{row.problem}</span>;
    return <Badge tone="blue">{running ? "Waiting" : "Ready"}</Badge>;
  }

  const columns = [
    { key: "rowNumber", label: "Row", width: "8%" },
    { key: "fullName", label: "Full Name", width: "18%" },
    { key: "email", label: "Email", width: "22%" },
    { key: "role", label: "Role", width: "13%", render: (row) => row.role || row.roleText || "-" },
    { key: "programCode", label: "Program", width: "10%", render: (row) => row.programCode || "-" },
    { key: "studentNumber", label: "Student No.", width: "11%", render: (row) => row.studentNumber || "-" },
    { key: "check", label: "Check", width: "18%", render: resultFor },
  ];

  return (
    <div className="modal-backdrop account-modal-backdrop" onClick={running ? undefined : onClose} role="presentation">
      <section aria-labelledby="bulk-register-title" aria-modal="true" className="card modal account-create-modal bulk-register-modal" onClick={(event) => event.stopPropagation()} role="dialog">
        <div className="account-modal-header">
          <div>
            <h2 id="bulk-register-title">Bulk Register {defaultRole ? `${defaultRole}s` : "Accounts"}</h2>
            <p>Create {defaultRole ? `${defaultRole.toLowerCase()}` : "professor, dean, cluster professor, and student"} accounts from an Excel (.xlsx) or CSV file of up to {MAX_ROWS} rows.</p>
          </div>
          <button aria-label="Close bulk register" disabled={running} onClick={onClose} type="button"><FiX /></button>
        </div>

        <div className="bulk-register-setup">
          <div className="bulk-register-file">
            <label className={`btn btn-light ${running || !existing ? "is-disabled" : ""}`}>
              <FiUpload /> {fileName ? "Choose another file" : "Choose Excel or CSV file"}
              <input accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={running || !existing} onChange={chooseFile} type="file" />
            </label>
            <p>{!existing ? "Checking existing accounts..." : fileName ? `${fileName} · ${fileRows.length} row${fileRows.length === 1 ? "" : "s"}` : "Columns: full_name, email, role, and an optional program (for example BSIT)."}</p>
            <button className="bulk-register-template" onClick={() => saveWorkbook(templateSheets(defaultRole || "Professor", programs), "staff-template.xlsx")} type="button">
              <FiDownload /> Download template
            </button>
          </div>
          <Field disabled={running} label="Default Password for This Batch" minLength={6} onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
        </div>

        {fileError ? <p className="bulk-register-error" role="alert">{fileError}</p> : null}

        {rows.length ? (
          <>
            <div aria-live="polite" className="bulk-register-summary">
              {results ? (
                <>
                  <Badge tone="success">{created} created</Badge>
                  {ready.length - created ? <Badge tone="danger">{ready.length - created} failed</Badge> : null}
                  {rows.length - ready.length ? <Badge tone="warn">{rows.length - ready.length} skipped</Badge> : null}
                  {running ? <span>Creating {Math.min(progress + 1, ready.length)} of {ready.length}...</span> : null}
                </>
              ) : (
                <>
                  <Badge tone="success">{ready.length} ready</Badge>
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
              <FiUserPlus /> {running ? "Creating..." : `Create ${ready.length} account${ready.length === 1 ? "" : "s"}`}
            </Button>
          ) : null}
        </div>
        {ready.length < rows.length && !results ? <p className="bulk-register-note">Rows that need fixing are skipped. Fix them in the file and upload it again to add them later.</p> : null}
      </section>
    </div>
  );
}
