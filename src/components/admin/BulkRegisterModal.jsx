import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FiDownload, FiUpload, FiUserPlus, FiX } from "react-icons/fi";
import { Badge, Button, Field, Table } from "../ui";
import { checkStaffRows, MAX_ROWS, readStaffCsv, resultsCsv, templateCsv } from "../../lib/bulkAccounts";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

function downloadCsv(text, fileName) {
  const url = window.URL.createObjectURL(new window.Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.URL.revokeObjectURL(url);
}

// defaultRole is the page's role ("" on Create Account, where the file must say the role).
// createAccount({ role, fullName, email, employeeNumber, password }) creates one account or throws.
export default function BulkRegisterModal({ defaultRole = "", existingAccounts = [], createAccount, onClose }) {
  const [existing, setExisting] = useState(hasSupabaseConfig ? null : {
    emails: existingAccounts.map((account) => account.email),
    employeeNumbers: existingAccounts.map((account) => account.employeeNumber),
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
    supabase.from("profiles").select("email, employee_number").limit(10000).then(({ data, error }) => {
      if (!active) return;
      if (error) {
        toast.error(error.message);
        setExisting({ emails: [], employeeNumbers: [] });
        return;
      }
      setExisting({
        emails: (data || []).map((profile) => profile.email),
        employeeNumbers: (data || []).map((profile) => profile.employee_number),
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
    existingEmployeeNumbers: existing.employeeNumbers,
  }) : []), [existing, fileRows]);
  const ready = rows.filter((row) => !row.problem);
  const created = results ? [...results.values()].filter((result) => result.status === "Created").length : 0;

  async function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const { rows: nextRows, error } = readStaffCsv(await file.text(), { defaultRole });
    setFileName(file.name);
    setFileRows(nextRows);
    setFileError(error);
    setResults(null);
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
        await createAccount({ role: row.role, fullName: row.fullName, email: row.email, employeeNumber: row.employeeNumber, password });
        nextResults.set(row.rowNumber, { status: "Created", message: "" });
      } catch (error) {
        nextResults.set(row.rowNumber, { status: "Failed", message: error.message || "Account was not created." });
      }
      setProgress((count) => count + 1);
      setResults(new Map(nextResults));
    }
    setRunning(false);
    const createdCount = [...nextResults.values()].filter((result) => result.status === "Created").length;
    if (createdCount) toast.success(`${createdCount} account${createdCount === 1 ? "" : "s"} created with default password ${password}`);
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
    { key: "fullName", label: "Full Name", width: "20%" },
    { key: "email", label: "Email", width: "26%" },
    { key: "employeeNumber", label: "Employee No.", width: "14%" },
    { key: "role", label: "Role", width: "14%", render: (row) => row.role || row.roleText || "-" },
    { key: "check", label: "Check", width: "18%", render: resultFor },
  ];

  return (
    <div className="modal-backdrop account-modal-backdrop" onClick={running ? undefined : onClose} role="presentation">
      <section aria-labelledby="bulk-register-title" aria-modal="true" className="card modal account-create-modal bulk-register-modal" onClick={(event) => event.stopPropagation()} role="dialog">
        <div className="account-modal-header">
          <div>
            <h2 id="bulk-register-title">Bulk Register {defaultRole ? `${defaultRole}s` : "Staff"}</h2>
            <p>Create {defaultRole ? `${defaultRole.toLowerCase()}` : "professor, dean and cluster professor"} accounts from a CSV file of up to {MAX_ROWS} rows.</p>
          </div>
          <button aria-label="Close bulk register" disabled={running} onClick={onClose} type="button"><FiX /></button>
        </div>

        <div className="bulk-register-setup">
          <div className="bulk-register-file">
            <label className={`btn btn-light ${running || !existing ? "is-disabled" : ""}`}>
              <FiUpload /> {fileName ? "Choose another file" : "Choose CSV file"}
              <input accept=".csv,text/csv" disabled={running || !existing} onChange={chooseFile} type="file" />
            </label>
            <p>{!existing ? "Checking existing accounts..." : fileName ? `${fileName} · ${fileRows.length} row${fileRows.length === 1 ? "" : "s"}` : "Columns: full_name, email, employee_number, role."}</p>
            <button className="bulk-register-template" onClick={() => downloadCsv(templateCsv(defaultRole || "Professor"), "staff-template.csv")} type="button">
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
            <Button onClick={() => downloadCsv(resultsCsv(rows, results), "staff-registration-results.csv")} type="button" variant="light"><FiDownload /> Download results</Button>
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
