import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FiRefreshCw, FiSlash, FiUserPlus } from "react-icons/fi";
import { Button, Card, Field, PageHeader, SearchBox, SelectField, Table, Badge } from "../components/ui";
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
  const [rowsByType, setRowsByType] = useLocalStorageState("smartproctor.people.byType", source);
  const [liveRowsByType, setLiveRowsByType] = useState(source);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ name: "", email: "", employeeNumber: "", password: "123456" });
  const [saving, setSaving] = useState(false);
  const accountType = type || selectedType;
  const rowsSource = hasSupabaseConfig ? liveRowsByType : rowsByType;
  const rows = useMemo(() => rowsSource[accountType] || source[accountType] || [], [accountType, rowsSource]);
  const title = getTitle(accountType, !type);

  const filtered = useMemo(() => rows.filter((row) => `${row.name} ${row.employeeNumber} ${row.email}`.toLowerCase().includes(search.toLowerCase())), [rows, search]);
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

  function updateRows(updater) {
    if (hasSupabaseConfig) {
      setLiveRowsByType((current) => ({
        ...current,
        [accountType]: updater(current[accountType] || []),
      }));
      return;
    }

    setRowsByType((current) => ({
      ...current,
      [accountType]: updater(current[accountType] || source[accountType] || []),
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
        updateRows((current) => [{ id: crypto.randomUUID(), ...form, status: "Active" }, ...current]);
      }

      setForm({ name: "", email: "", employeeNumber: "", password: "123456" });
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
        updateRows((current) => current.map((item) => item.id === row.id ? { ...item, status } : item));
      }

      toast.success(`${accountType} ${status.toLowerCase()}`);
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
    { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "Active" ? "success" : row.status === "Pending" ? "warn" : "danger"}>{row.status}</Badge> },
  ];

  return (
    <section className="admin-dashboard-page admin-section-page">
      <div className="admin-section-hero">
        <div>
          <span><FiUserPlus /> Account Provisioning</span>
          <h1>{title}</h1>
          <p>Create, reset, deactivate, and reactivate {accountType.toLowerCase()} accounts with the same monitored identity workflow used across the platform.</p>
        </div>
        <strong>{filtered.length}</strong>
      </div>
      <PageHeader title={title} subtitle={`Create, reset, deactivate, and reactivate ${accountType.toLowerCase()} accounts.`} />
      <Card className="admin-panel admin-form-panel">
        <form className="inline-form" onSubmit={createPerson}>
          {!type ? (
            <SelectField label="Account Type" value={selectedType} onChange={(event) => setSelectedType(event.target.value)}>
              {accountTypes.map((item) => <option key={item}>{item}</option>)}
            </SelectField>
          ) : null}
          <Field label="Full Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          <Field label="Email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          <Field label="Employee Number" value={form.employeeNumber} onChange={(event) => setForm({ ...form, employeeNumber: event.target.value })} required />
          <Field label="Default Password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required minLength={6} />
          <Button disabled={saving}><FiUserPlus /> {saving ? "Creating..." : `Create ${accountType}`}</Button>
        </form>
      </Card>
      <SearchBox value={search} onChange={setSearch} placeholder="Search by name or employee number" />
      <Card className="admin-panel admin-activity-panel">
        <h2>Active {getPlural(accountType)}</h2>
        <Table columns={columns} rows={active} renderActions={(row) => (
          <>
            <Button variant="light" onClick={() => resetPassword(row)}><FiRefreshCw /> Reset Password</Button>
            <Button variant="light" onClick={() => setStatus(row, "Deactivated")}><FiSlash /> Deactivate</Button>
          </>
        )} />
      </Card>
      <Card className="admin-panel admin-activity-panel">
        <h2>Deactivated {getPlural(accountType)}</h2>
        <Table columns={columns} rows={deactivated} renderActions={(row) => <Button variant="light" onClick={() => setStatus(row, "Active")}>Reactivate</Button>} />
      </Card>
    </section>
  );
}
