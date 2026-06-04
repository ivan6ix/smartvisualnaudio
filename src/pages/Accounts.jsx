import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button, Card, PageHeader, SearchBox, SelectField, Table, Badge } from "../components/ui";
import { accounts as seedAccounts, roles } from "../data/mockData";
import { useAuth } from "../context/AuthContext";
import useLocalStorageState from "../hooks/useLocalStorageState";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

function mapProfile(profile) {
  return {
    id: profile.id,
    displayId: profile.employee_number || profile.student_number || profile.email || profile.id,
    name: profile.full_name || profile.email || "Unnamed account",
    email: profile.email || "",
    role: profile.role || "Student",
    status: profile.status || "Pending",
  };
}

export default function Accounts() {
  const { user } = useAuth();
  const [storedAccounts, setStoredAccounts] = useLocalStorageState("smartproctor.admin.accounts", seedAccounts);
  const [liveAccounts, setLiveAccounts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("All Roles");
  const accounts = useMemo(
    () => (hasSupabaseConfig ? liveAccounts : storedAccounts.map((account) => ({ ...account, displayId: account.displayId || account.id }))),
    [liveAccounts, storedAccounts],
  );

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined;

    async function loadAccounts() {
      setLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, role, full_name, email, employee_number, student_number, status, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        toast.error(error.message);
      } else {
        setLiveAccounts((data || []).map(mapProfile));
      }
      setLoading(false);
    }

    loadAccounts();

    const channel = supabase
      .channel("admin-manage-accounts")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        loadAccounts();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => accounts.filter((account) => {
    const matchesRole = role === "All Roles" || account.role === role;
    const matchesSearch = `${account.name} ${account.displayId || account.id} ${account.email || ""} ${account.role}`.toLowerCase().includes(search.toLowerCase());
    return matchesRole && matchesSearch;
  }), [accounts, role, search]);

  async function callAccountFunction(body) {
    const { data, error } = await supabase.functions.invoke("create-account", { body });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function setStatus(account, status) {
    if (account.id === user?.id && status === "Deactivated") {
      toast.error("Admins cannot deactivate their own account");
      return;
    }

    try {
      if (hasSupabaseConfig) {
        const data = await callAccountFunction({ action: "update-status", userId: account.id, status });
        setLiveAccounts((current) => current.map((item) => item.id === account.id ? mapProfile(data.profile) : item));
      } else {
        setStoredAccounts((current) => current.map((item) => item.id === account.id ? { ...item, status } : item));
      }
      toast.success(`Account ${status.toLowerCase()}`);
    } catch (error) {
      toast.error(error.message);
    }
  }

  const columns = [
    { key: "name", label: "Name" },
    { key: "displayId", label: "ID", render: (row) => row.displayId || row.id },
    { key: "role", label: "Role" },
    { key: "status", label: "Status", render: (row) => <Badge tone={row.status === "Active" ? "success" : row.status === "Pending" ? "warn" : "danger"}>{row.status}</Badge> },
  ];

  return (
    <>
      <PageHeader title="Manage Accounts" subtitle="Filter, deactivate, and reactivate users across all roles." />
      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Search accounts" />
        <SelectField label="Role Filter" value={role} onChange={(event) => setRole(event.target.value)}>
          <option>All Roles</option>
          {roles.map((item) => <option key={item}>{item}</option>)}
        </SelectField>
      </div>
      <Card>
        <h2>Active Accounts</h2>
        {loading ? <p className="muted">Loading live accounts...</p> : null}
        <Table columns={columns} rows={filtered.filter((account) => account.status !== "Deactivated")} renderActions={(row) => <Button variant="light" onClick={() => setStatus(row, "Deactivated")}>Deactivate</Button>} />
      </Card>
      <Card>
        <h2>Deactivated Accounts</h2>
        <Table columns={columns} rows={filtered.filter((account) => account.status === "Deactivated")} renderActions={(row) => <Button variant="light" onClick={() => setStatus(row, "Active")}>Reactivate</Button>} />
      </Card>
    </>
  );
}
