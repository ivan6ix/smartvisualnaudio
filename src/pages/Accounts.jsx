import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FiUsers } from "react-icons/fi";
import { ListPagination, ListViewToolbar, RecordCardList } from "../components/ListViewControls";
import { Button, Card, PageHeader, SearchBox, SelectField, Table, Badge } from "../components/ui";
import { accounts as seedAccounts, roles } from "../data/mockData";
import { useAuth } from "../context/AuthContext";
import useListViewPreference from "../hooks/useListViewPreference";
import useLocalStorageState from "../hooks/useLocalStorageState";
import { getListPageSlice } from "../lib/listView";
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
  const queryClient = useQueryClient();
  const [storedAccounts, setStoredAccounts] = useLocalStorageState("smartproctor.admin.accounts", seedAccounts);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [role, setRole] = useState("All Roles");
  const [activePage, setActivePage] = useState(1);
  const [deactivatedPage, setDeactivatedPage] = useState(1);
  const listView = useListViewPreference({ role: "admin", page: "accounts", defaultView: "table" });
  const accountsQuery = useQuery({
    queryKey: ["admin-accounts"],
    enabled: hasSupabaseConfig,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, role, full_name, email, employee_number, student_number, status, created_at")
        .order("created_at", { ascending: false })
        .limit(250);

      if (error) throw error;
      return (data || []).map(mapProfile);
    },
  });
  const accounts = useMemo(
    () => (hasSupabaseConfig ? accountsQuery.data || [] : storedAccounts.map((account) => ({ ...account, displayId: account.displayId || account.id }))),
    [accountsQuery.data, storedAccounts],
  );

  useEffect(() => {
    if (accountsQuery.error) toast.error(accountsQuery.error.message);
  }, [accountsQuery.error]);

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined;

    const channel = supabase
      .channel("admin-manage-accounts")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["admin-accounts"] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const filtered = useMemo(() => accounts.filter((account) => {
    const matchesRole = role === "All Roles" || account.role === role;
    const matchesSearch = `${account.name} ${account.displayId || account.id} ${account.email || ""} ${account.role}`.toLowerCase().includes(search.trim().toLowerCase());
    return matchesRole && matchesSearch && (statusFilter === "All" || account.status === statusFilter);
  }), [accounts, role, search, statusFilter]);

  useEffect(() => {
    setActivePage(1);
    setDeactivatedPage(1);
  }, [role, search, statusFilter]);

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
        queryClient.setQueryData(["admin-accounts"], (current = []) => current.map((item) => item.id === account.id ? mapProfile(data.profile) : item));
      } else {
        setStoredAccounts((current) => current.map((item) => item.id === account.id ? { ...item, status } : item));
      }
      toast.success(`Account ${status.toLowerCase()}`);
    } catch (error) {
      toast.error(error.message);
    }
  }

  const columns = [
    { key: "name", label: "Name", width: "25%" },
    { key: "displayId", label: "ID", width: "20%", render: (row) => row.displayId || row.id },
    { key: "role", label: "Role", width: "20%" },
    { key: "status", label: "Status", width: "17.5%", className: "admin-table-center", render: (row) => <Badge tone={row.status === "Active" ? "success" : row.status === "Pending" ? "warn" : "danger"}>{row.status}</Badge> },
  ];
  const activeRows = filtered.filter((account) => account.status !== "Deactivated");
  const deactivatedRows = filtered.filter((account) => account.status === "Deactivated");
  const activePageData = getListPageSlice(activeRows, activePage, listView.pageSize);
  const deactivatedPageData = getListPageSlice(deactivatedRows, deactivatedPage, listView.pageSize);

  function renderAccounts(rows, action, pageData, setPage) {
    return (
      <>
        {listView.view === "cards" ? (
          <RecordCardList columns={columns} density={listView.cardDensity} rows={pageData.rows} titleKey="name" renderActions={action} />
        ) : (
          <Table className={`admin-account-table ${action.tableClassName || ""} list-table-${listView.tableDensity}`} columns={columns} rows={pageData.rows} emptyTitle="No accounts match your search or filters." emptyDescription="Clear the search or choose All Roles to show more accounts." renderActions={action} />
        )}
        <ListPagination count={rows.length} page={pageData.page} pageSize={listView.pageSize} onPage={setPage} />
      </>
    );
  }

  return (
    <section className="admin-dashboard-page admin-section-page">
      <div className="admin-section-hero">
        <div>
          <span><FiUsers /> Identity Directory</span>
          <h1>Manage Accounts</h1>
          <p>Filter, deactivate, and reactivate users across Admin, Professor, Dean, Cluster Professor, and Student roles.</p>
        </div>
        <strong>{filtered.length}</strong>
      </div>
      <PageHeader title="Manage Accounts" subtitle="Filter, deactivate, and reactivate users across all roles." />
      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Search accounts" />
        <SelectField label="Role Filter" value={role} onChange={(event) => setRole(event.target.value)}>
          <option>All Roles</option>
          {roles.map((item) => <option key={item}>{item}</option>)}
        </SelectField><SelectField label="Status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>{["All", "Active", "Pending", "Deactivated"].map(status => <option key={status}>{status}</option>)}</SelectField>
      </div>
      <ListViewToolbar
        controls={{
          cardDensity: listView.cardDensity,
          onCardDensity: listView.setCardDensity,
          onTableDensity: listView.setTableDensity,
          onView: (nextView) => {
            setActivePage(listView.switchViewPreservingPage(nextView, activePageData.page, activeRows.length));
            setDeactivatedPage(1);
          },
          tableDensity: listView.tableDensity,
          view: listView.view,
        }}
      />
      <Card className="admin-panel admin-activity-panel">
        <h2>Active Accounts</h2>
        {accountsQuery.isPending && !accounts.length ? <p className="muted">Loading live accounts...</p> : null}
        {renderAccounts(activeRows, Object.assign((row) => <Button variant="light" onClick={() => setStatus(row, "Deactivated")}>Deactivate</Button>, { width: "17.5%", tableClassName: "admin-account-table-active" }), activePageData, setActivePage)}
      </Card>
      <Card className="admin-panel admin-activity-panel">
        <h2>Deactivated Accounts</h2>
        {renderAccounts(deactivatedRows, Object.assign((row) => <Button variant="light" onClick={() => setStatus(row, "Active")}>Reactivate</Button>, { width: "17.5%", tableClassName: "admin-account-table-deactivated" }), deactivatedPageData, setDeactivatedPage)}
      </Card>
    </section>
  );
}
