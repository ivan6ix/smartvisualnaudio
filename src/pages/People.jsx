import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FiBookOpen, FiRefreshCw, FiSlash, FiUserPlus, FiUsers, FiX } from "react-icons/fi";
import BulkRegisterModal from "../components/admin/BulkRegisterModal";
import { Button, Card, Field, SearchBox, SelectField, Table, Badge, RowActionMenu } from "../components/ui";
import { clusterProfessors, deans, professors } from "../data/mockData";
import useLocalStorageState from "../hooks/useLocalStorageState";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

const source = {
  Professor: professors,
  Dean: deans,
  "Cluster Professor": clusterProfessors,
};

const accountTypes = ["Professor", "Dean", "Cluster Professor"];
const CLUSTER = "Cluster Professor";
const emptyForm = { name: "", email: "", employeeNumber: "", password: "123456", programId: "" };

function getTitle(type, isUnified) {
  if (isUnified) return "Create Account";
  if (type === "Professor") return "Professors";
  if (type === "Dean") return "Create Dean";
  return "Cluster Professor";
}

function getPlural(type) {
  if (type === "Cluster Professor") return "Cluster Professors";
  return `${type}s`;
}

function mapProfile(profile) {
  return {
    id: profile.id,
    name: profile.full_name,
    email: profile.email,
    employeeNumber: profile.employee_number || "-",
    status: profile.status || "Pending",
    role: profile.role,
  };
}

export default function People({ type }) {
  const [selectedType, setSelectedType] = useState(type || "Professor");
  const [roleFilter, setRoleFilter] = useState("All Account Types");
  const [rowsByType, setRowsByType] = useLocalStorageState("smartproctor.people.byType", source);
  const [liveRowsByType, setLiveRowsByType] = useState(source);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  // Each Cluster Professor reviews the exams of one program.
  const [programs, setPrograms] = useState([]);
  const [programByCluster, setProgramByCluster] = useState({});
  const [assignTarget, setAssignTarget] = useState(null);
  const [assignProgramId, setAssignProgramId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const closeBulkModal = useCallback(() => setBulkModalOpen(false), []);
  const [openActionMenuId, setOpenActionMenuId] = useState("");
  const isUnified = !type;
  const accountType = type || selectedType;
  const rowsSource = hasSupabaseConfig ? liveRowsByType : rowsByType;
  const rows = useMemo(() => {
    if (!isUnified) return rowsSource[accountType] || source[accountType] || [];
    return accountTypes.flatMap((role) => (rowsSource[role] || source[role] || []).map((row) => ({ ...row, role: row.role || role })));
  }, [accountType, isUnified, rowsSource]);
  const title = getTitle(accountType, isUnified);

  const filtered = useMemo(() => rows.filter((row) => {
    const matchesRole = !isUnified || roleFilter === "All Account Types" || row.role === roleFilter;
    const matchesSearch = `${row.name} ${row.employeeNumber} ${row.email}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesRole && matchesSearch;
  }), [isUnified, roleFilter, rows, search]);
  const active = filtered.filter((row) => row.status === "Active");
  const deactivated = filtered.filter((row) => row.status === "Deactivated");

  useEffect(() => {
    if (!hasSupabaseConfig) return;

    async function loadPeople() {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, role, full_name, email, employee_number, status")
        .in("role", accountTypes)
        .order("created_at", { ascending: false });

      if (error) {
        toast.error(error.message);
        return;
      }

      const grouped = accountTypes.reduce((items, role) => ({ ...items, [role]: [] }), {});
      (data || []).forEach((profile) => {
        grouped[profile.role] = [...(grouped[profile.role] || []), mapProfile(profile)];
      });
      setLiveRowsByType(grouped);

      const [{ data: programRows, error: programError }, { data: clusterRows, error: clusterError }] = await Promise.all([
        supabase.from("programs").select("id, program_code, program_name, is_active").order("program_code"),
        supabase.from("cluster_professors").select("id, program_id"),
      ]);
      if (programError || clusterError) {
        toast.error((programError || clusterError).message);
        return;
      }
      setPrograms(programRows || []);
      setProgramByCluster(Object.fromEntries((clusterRows || []).map((row) => [row.id, row.program_id || ""])));
    }

    loadPeople();
  }, []);

  const activePrograms = useMemo(() => programs.filter((program) => program.is_active), [programs]);
  const programById = useMemo(() => new Map(programs.map((program) => [program.id, program])), [programs]);
  const showProgramColumn = isUnified || accountType === CLUSTER;

  const resetForm = useCallback(function resetForm() {
    setForm(emptyForm);
    if (!type) setSelectedType("Professor");
  }, [type]);

  const closeCreateModal = useCallback(function closeCreateModal() {
    if (saving) return;
    setCreateModalOpen(false);
    resetForm();
  }, [resetForm, saving]);

  useEffect(() => {
    if (!createModalOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") closeCreateModal();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeCreateModal, createModalOpen]);

  function updateRows(role, updater) {
    if (hasSupabaseConfig) {
      setLiveRowsByType((current) => ({
        ...current,
        [role]: updater(current[role] || []),
      }));
      return;
    }

    setRowsByType((current) => ({
      ...current,
      [role]: updater(current[role] || source[role] || []),
    }));
  }

  function updateLiveProfile(profile) {
    setLiveRowsByType((current) => {
      const next = { ...current };
      accountTypes.forEach((role) => {
        next[role] = (next[role] || []).filter((row) => row.id !== profile.id);
      });
      next[profile.role] = [mapProfile(profile), ...(next[profile.role] || [])];
      return next;
    });
  }

  async function callAccountFunction(body) {
    const { data, error } = await supabase.functions.invoke("create-account", { body });
    if (error) {
      // A non-2xx reply hides the function's own message (for example a taken email) in the response body.
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.error || error.message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function createAccount({ role, fullName, email, employeeNumber, password, programId = "" }) {
    if (hasSupabaseConfig) {
      const data = await callAccountFunction({ action: "create", role, fullName, email, employeeNumber, password, ...(role === CLUSTER ? { programId } : {}) });
      updateLiveProfile(data.profile);
      if (role === CLUSTER) setProgramByCluster((current) => ({ ...current, [data.profile.id]: data.profile.program_id || "" }));
      return;
    }
    updateRows(role, (current) => [{ id: crypto.randomUUID(), name: fullName, email, employeeNumber, role, status: "Active" }, ...current]);
  }

  async function createPerson(event) {
    event.preventDefault();
    if (accountType === CLUSTER && hasSupabaseConfig && !form.programId) {
      toast.error("Choose the program this Cluster Professor will review.");
      return;
    }
    setSaving(true);

    try {
      await createAccount({
        role: accountType,
        fullName: form.name,
        email: form.email,
        employeeNumber: form.employeeNumber,
        password: form.password || "123456",
        programId: form.programId,
      });

      resetForm();
      setCreateModalOpen(false);
      toast.success(`${accountType} created with default password ${form.password || "123456"}. They will set their own at first sign-in.`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(row, status) {
    try {
      if (hasSupabaseConfig) {
        const data = await callAccountFunction({ action: "update-status", userId: row.id, status });
        updateLiveProfile(data.profile);
      } else {
        updateRows(row.role || accountType, (current) => current.map((item) => item.id === row.id ? { ...item, status } : item));
      }

      toast.success(`${row.role || accountType} ${status.toLowerCase()}`);
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function resetPassword(row) {
    try {
      if (hasSupabaseConfig) {
        await callAccountFunction({ action: "reset-password", userId: row.id, password: "123456" });
      }
      toast.success("Password reset to 123456. They will set their own at next sign-in.");
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function assignProgram(event) {
    event.preventDefault();
    if (!assignTarget || !assignProgramId) {
      toast.error("Choose a program.");
      return;
    }
    setAssigning(true);
    try {
      await callAccountFunction({ action: "assign-program", userId: assignTarget.id, programId: assignProgramId });
      setProgramByCluster((current) => ({ ...current, [assignTarget.id]: assignProgramId }));
      toast.success(`${assignTarget.name} now reviews ${programById.get(assignProgramId)?.program_code || "the selected program"} exams.`);
      setAssignTarget(null);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setAssigning(false);
    }
  }

  function openAssignProgram(row) {
    setAssignTarget(row);
    setAssignProgramId(programByCluster[row.id] || "");
  }

  function programCell(row) {
    if ((row.role || accountType) !== CLUSTER) return <span className="account-program-none">-</span>;
    const program = programById.get(programByCluster[row.id]);
    return program ? <Badge>{program.program_code}</Badge> : <Badge tone="warn">Not assigned</Badge>;
  }

  const columns = [
    { key: "name", label: "Name", width: "18%" },
    { key: "email", label: "Email", width: showProgramColumn ? "22%" : "25%" },
    { key: "employeeNumber", label: "Employee Number", width: showProgramColumn ? "14%" : "17%" },
    { key: "role", label: "Account Type", width: showProgramColumn ? "15%" : "17%", render: (row) => <Badge>{row.role || accountType}</Badge> },
    ...(showProgramColumn ? [{ key: "program", label: "Program", width: "10%", render: programCell }] : []),
    { key: "status", label: "Status", width: showProgramColumn ? "11%" : "13%", className: "admin-table-center", render: (row) => <Badge tone={row.status === "Active" ? "success" : row.status === "Pending" ? "warn" : "danger"}>{row.status}</Badge> },
  ];

  const createForm = (
    <form className="account-create-form" onSubmit={createPerson}>
      {isUnified ? (
        <SelectField label="Account Type" value={selectedType} onChange={(event) => setSelectedType(event.target.value)}>
          {accountTypes.map((item) => <option key={item}>{item}</option>)}
        </SelectField>
      ) : null}
      <Field label="Full Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
      <Field label="Email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
      <Field label="Employee Number" value={form.employeeNumber} onChange={(event) => setForm({ ...form, employeeNumber: event.target.value })} required />
      <Field label="Default Password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required minLength={6} />
      {accountType === CLUSTER ? (
        <SelectField label="Program to Review" value={form.programId} onChange={(event) => setForm({ ...form, programId: event.target.value })} required={hasSupabaseConfig}>
          <option value="">Select program</option>
          {activePrograms.map((program) => <option key={program.id} value={program.id}>{program.program_code} - {program.program_name}</option>)}
        </SelectField>
      ) : null}
      <div className="account-modal-actions">
        <Button disabled={saving} type="button" variant="light" onClick={closeCreateModal}>Cancel</Button>
        <Button disabled={saving}><FiUserPlus /> {saving ? "Creating..." : `Create ${accountType}`}</Button>
      </div>
    </form>
  );

  return (
    <section className="admin-dashboard-page admin-section-page">
      <div className="admin-section-hero account-create-hero">
        <div>
          <span><FiUserPlus /> Account Provisioning</span>
          <h1>{title}</h1>
          <p>Create, reset, deactivate, and reactivate {isUnified ? "managed" : accountType.toLowerCase()} accounts with the same monitored identity workflow used across the platform.</p>
        </div>
        <div className="account-hero-actions">
          <div className="account-count-card" aria-label={`${rows.length} ${isUnified ? "Accounts" : getPlural(accountType)}`}>
            <span>{isUnified ? "Accounts" : getPlural(accountType)}</span>
            <strong>{rows.length}</strong>
          </div>
          <Button onClick={() => setCreateModalOpen(true)}><FiUserPlus /> {isUnified ? "Create Account" : `Create ${accountType}`}</Button>
          <Button onClick={() => setBulkModalOpen(true)} variant="light"><FiUsers /> Bulk Register</Button>
        </div>
      </div>
      <div className="account-list-toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, email, or employee number" />
        {isUnified ? (
          <SelectField label="Account Type Filter" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option>All Account Types</option>
            {accountTypes.map((item) => <option key={item}>{item}</option>)}
          </SelectField>
        ) : null}
      </div>
      <Card className="admin-panel admin-activity-panel">
        <h2>{isUnified ? "Active Accounts" : `Active ${getPlural(accountType)}`}</h2>
        <Table className="admin-account-table admin-account-table-active" columns={columns} rows={active} emptyTitle="No accounts match your search or filters." emptyDescription="Clear the search or select all roles to show more accounts." renderActions={Object.assign((row) => (
          <RowActionMenu
            actions={[
              ...((row.role || accountType) === CLUSTER && hasSupabaseConfig ? [{ icon: FiBookOpen, label: programByCluster[row.id] ? "Change Program" : "Assign Program", onClick: () => openAssignProgram(row) }] : []),
              { icon: FiRefreshCw, label: "Reset Password", onClick: () => resetPassword(row) },
              { danger: true, icon: FiSlash, label: "Deactivate", onClick: () => setStatus(row, "Deactivated") },
            ]}
            label={`More actions for ${row.name || row.email || "account"}`}
            menuId={`account-actions-${row.id}`}
            openMenuId={openActionMenuId}
            rowId={row.id}
            setOpenMenuId={setOpenActionMenuId}
          />
        ), { width: "10%" })} />
      </Card>
      <Card className="admin-panel admin-activity-panel">
        <h2>{isUnified ? "Deactivated Accounts" : `Deactivated ${getPlural(accountType)}`}</h2>
        <Table className="admin-account-table admin-account-table-deactivated" columns={columns} rows={deactivated} emptyTitle="No accounts match your search or filters." emptyDescription="Clear the search or select all roles to show more accounts." renderActions={Object.assign((row) => <Button variant="light" onClick={() => setStatus(row, "Active")}>Reactivate</Button>, { width: "10%" })} />
      </Card>
      {createModalOpen ? (
        <div className="modal-backdrop account-modal-backdrop" onClick={closeCreateModal} role="presentation">
          <section aria-labelledby="create-account-modal-title" aria-modal="true" className="card modal account-create-modal" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="account-modal-header">
              <div>
                <h2 id="create-account-modal-title">{isUnified ? "Create Account" : `Create ${accountType} Account`}</h2>
                <p>Enter the account information for this {accountType.toLowerCase()}.</p>
              </div>
              <button aria-label="Close create account modal" disabled={saving} onClick={closeCreateModal} type="button">
                <FiX />
              </button>
            </div>
            {createForm}
          </section>
        </div>
      ) : null}
      {assignTarget ? (
        <div className="modal-backdrop account-modal-backdrop" onClick={() => (assigning ? null : setAssignTarget(null))} role="presentation">
          <section aria-labelledby="assign-program-title" aria-modal="true" className="card modal account-create-modal account-program-modal" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="account-modal-header">
              <div>
                <h2 id="assign-program-title">{programByCluster[assignTarget.id] ? "Change Program" : "Assign Program"}</h2>
                <p>{assignTarget.name} will review only exams from courses in this program.</p>
              </div>
              <button aria-label="Close assign program" disabled={assigning} onClick={() => setAssignTarget(null)} type="button">
                <FiX />
              </button>
            </div>
            <form className="account-create-form" onSubmit={assignProgram}>
              <SelectField label="Program to Review" value={assignProgramId} onChange={(event) => setAssignProgramId(event.target.value)} required>
                <option value="">Select program</option>
                {activePrograms.map((program) => <option key={program.id} value={program.id}>{program.program_code} - {program.program_name}</option>)}
              </SelectField>
              <div className="account-modal-actions">
                <Button disabled={assigning} type="button" variant="light" onClick={() => setAssignTarget(null)}>Cancel</Button>
                <Button disabled={assigning || !assignProgramId}><FiBookOpen /> {assigning ? "Saving..." : "Save Program"}</Button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {bulkModalOpen ? (
        <BulkRegisterModal
          createAccount={createAccount}
          defaultRole={type || ""}
          existingAccounts={accountTypes.flatMap((role) => rowsSource[role] || [])}
          onClose={closeBulkModal}
        />
      ) : null}
    </section>
  );
}
