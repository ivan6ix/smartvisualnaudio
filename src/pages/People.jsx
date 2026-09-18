import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FiRefreshCw, FiSlash, FiUserPlus, FiX } from "react-icons/fi";
import { Button, Card, Field, SearchBox, SelectField, Table, Badge } from "../components/ui";
import { clusterProfessors, deans, professors } from "../data/mockData";
import useLocalStorageState from "../hooks/useLocalStorageState";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

const source = {
  Professor: professors,
  Dean: deans,
  "Cluster Professor": clusterProfessors,
};

const accountTypes = ["Professor", "Dean", "Cluster Professor"];

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
  const [form, setForm] = useState({ name: "", email: "", employeeNumber: "", password: "123456" });
  const [saving, setSaving] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
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
    const matchesSearch = `${row.name} ${row.employeeNumber} ${row.email}`.toLowerCase().includes(search.toLowerCase());
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
    }

    loadPeople();
  }, []);

  const resetForm = useCallback(function resetForm() {
    setForm({ name: "", email: "", employeeNumber: "", password: "123456" });
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
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function createPerson(event) {
    event.preventDefault();
    setSaving(true);

    try {
      if (hasSupabaseConfig) {
        const data = await callAccountFunction({
          action: "create",
          role: accountType,
          fullName: form.name,
          email: form.email,
          employeeNumber: form.employeeNumber,
          password: form.password || "123456",
        });
        updateLiveProfile(data.profile);
      } else {
        updateRows(accountType, (current) => [{ id: crypto.randomUUID(), ...form, role: accountType, status: "Active" }, ...current]);
      }

      resetForm();
      setCreateModalOpen(false);
      toast.success(`${accountType} created with default password ${form.password || "123456"}`);
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
      toast.success("Password reset to 123456");
    } catch (error) {
      toast.error(error.message);
    }
  }

  const columns = [
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "employeeNumber", label: "Employee Number" },
    { key: "role", label: "Account Type", render: (row) => <Badge>{row.role || accountType}</Badge> },
    { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "Active" ? "success" : row.status === "Pending" ? "warn" : "danger"}>{row.status}</Badge> },
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
        <Table columns={columns} rows={active} renderActions={(row) => (
          <>
            <Button variant="light" onClick={() => resetPassword(row)}><FiRefreshCw /> Reset Password</Button>
            <Button variant="light" onClick={() => setStatus(row, "Deactivated")}><FiSlash /> Deactivate</Button>
          </>
        )} />
      </Card>
      <Card className="admin-panel admin-activity-panel">
        <h2>{isUnified ? "Deactivated Accounts" : `Deactivated ${getPlural(accountType)}`}</h2>
        <Table columns={columns} rows={deactivated} renderActions={(row) => <Button variant="light" onClick={() => setStatus(row, "Active")}>Reactivate</Button>} />
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
    </section>
  );
}
