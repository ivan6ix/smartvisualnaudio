import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FiClock, FiEye, FiRefreshCw, FiShield } from "react-icons/fi";
import { ListPagination } from "../components/ListViewControls";
import { Badge, Button, Card, Field, PageHeader, SearchBox, SelectField, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import {
  AUDIT_LOG_PAGE_SIZE,
  buildAuditLogRange,
  getAuditLogSort,
  mapAuditLogRow,
  sanitizeAuditMetadata,
} from "../lib/auditLogs";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

const ALL = "all";
const SORT_OPTIONS = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
];
const EVENT_OPTIONS = [
  "account.created",
  "account.activated",
  "account.deactivated",
  "account.password_reset_admin",
  "account.password_reset_requested",
  "course.created",
  "course.archived",
  "course.restored",
  "program.created",
  "program.updated",
  "program.deactivated",
  "program.restored",
  "exam.approved",
  "exam.rejected",
  "exam.archived",
  "exam.restored",
  "attempt.reopen_requested",
  "attempt.reopen_approved",
  "attempt.reopen_rejected",
  "attempt.reopen_resubmitted",
];
const ENTITY_OPTIONS = ["account", "course", "program", "exam", "attempt"];

function toDateStart(value) {
  return value ? `${value}T00:00:00.000Z` : "";
}

function toDateEnd(value) {
  return value ? `${value}T23:59:59.999Z` : "";
}

function buildSearchOr(search, actorIds) {
  const value = search.trim();
  if (!value) return "";
  const escaped = value.replaceAll(",", " ").replaceAll("%", "\\%");
  const clauses = [
    `action.ilike.%${escaped}%`,
    `description.ilike.%${escaped}%`,
    `event_type.ilike.%${escaped}%`,
    `entity_type.ilike.%${escaped}%`,
  ];
  if (actorIds.length) clauses.push(`user_id.in.(${actorIds.join(",")})`);
  return clauses.join(",");
}

export default function AdminLogs() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState(ALL);
  const [eventType, setEventType] = useState(ALL);
  const [entityType, setEntityType] = useState(ALL);
  const [actorId, setActorId] = useState(ALL);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState("newest");
  const [selectedLog, setSelectedLog] = useState(null);
  const [hasNewActivity, setHasNewActivity] = useState(false);

  const actorsQuery = useQuery({
    queryKey: ["admin-log-actors"],
    enabled: hasSupabaseConfig && user?.role === "Admin",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email, role")
        .order("full_name", { ascending: true })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  const searchActorIdsQuery = useQuery({
    queryKey: ["admin-log-search-actors", search],
    enabled: hasSupabaseConfig && user?.role === "Admin" && search.trim().length > 1,
    queryFn: async () => {
      const term = search.trim().replaceAll(",", " ");
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
        .limit(50);
      if (error) throw error;
      return (data || []).map((profile) => profile.id);
    },
  });

  const logsQuery = useQuery({
    queryKey: ["admin-logs", page, search, role, eventType, entityType, actorId, dateFrom, dateTo, sort, searchActorIdsQuery.data],
    enabled: hasSupabaseConfig && user?.role === "Admin" && !searchActorIdsQuery.isFetching,
    queryFn: async () => {
      const range = buildAuditLogRange(page);
      const order = getAuditLogSort(sort);
      let query = supabase
        .from("logs")
        .select("id, user_id, actor_role, event_type, action, description, entity_type, entity_id, target_user_id, metadata, created_at, profiles:user_id(full_name,email,role)", { count: "exact" })
        .order(order.column, { ascending: order.ascending })
        .range(range.from, range.to);

      if (role !== ALL) query = query.eq("actor_role", role);
      if (eventType !== ALL) query = query.eq("event_type", eventType);
      if (entityType !== ALL) query = query.eq("entity_type", entityType);
      if (actorId !== ALL) query = query.eq("user_id", actorId);
      if (dateFrom) query = query.gte("created_at", toDateStart(dateFrom));
      if (dateTo) query = query.lte("created_at", toDateEnd(dateTo));
      const searchOr = buildSearchOr(search, searchActorIdsQuery.data || []);
      if (searchOr) query = query.or(searchOr);

      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data || []).map(mapAuditLogRow), count: count || 0 };
    },
    keepPreviousData: true,
  });

  const filters = [search, role, eventType, entityType, actorId, dateFrom, dateTo, sort].join("|");
  useEffect(() => {
    setPage(1);
  }, [filters]);

  useEffect(() => {
    if (!hasSupabaseConfig || user?.role !== "Admin") return undefined;
    const channel = supabase
      .channel("admin-logs-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "logs" }, () => setHasNewActivity(true))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setHasNewActivity(true);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.role]);

  const rows = logsQuery.data?.rows || [];
  const count = logsQuery.data?.count || 0;
  const actorOptions = actorsQuery.data || [];

  function refreshLogs() {
    setHasNewActivity(false);
    void logsQuery.refetch();
  }

  const columns = [
    { key: "createdAt", label: "Date & Time", width: "16%" },
    { key: "actor", label: "Actor", width: "18%" },
    { key: "role", label: "Role", width: "10%", render: (row) => <Badge>{row.role}</Badge> },
    { key: "action", label: "Action", width: "16%" },
    { key: "entity", label: "Entity / Context", width: "15%" },
    { key: "description", label: "Description" },
  ];

  if (!hasSupabaseConfig) {
    return <div className="empty-state">Audit logs require Supabase configuration.</div>;
  }

  return (
    <section className="admin-dashboard-page admin-section-page admin-logs-page">
      <div className="admin-section-hero">
        <div>
          <span><FiShield /> System Audit Trail</span>
          <h1>Admin Logs</h1>
          <p>Review state-changing account, course, program, exam, attempt, and grading events.</p>
        </div>
        <strong>{count.toLocaleString()}</strong>
      </div>
      <PageHeader
        title="Admin Logs"
        subtitle="Read-only system audit records. Detailed proctoring violations remain in Exam Integrity."
        actions={hasNewActivity ? <Button variant="light" onClick={refreshLogs}><FiRefreshCw /> New activity available</Button> : null}
      />
      <Card className="admin-panel admin-log-filters">
        <SearchBox value={search} onChange={setSearch} placeholder="Search actor, action, event, or description" />
        <Field label="From" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        <Field label="To" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        <SelectField label="Actor" value={actorId} onChange={(event) => setActorId(event.target.value)}>
          <option value={ALL}>All actors</option>
          {actorOptions.map((actor) => <option key={actor.id} value={actor.id}>{actor.full_name || actor.email}</option>)}
        </SelectField>
        <SelectField label="Role" value={role} onChange={(event) => setRole(event.target.value)}>
          <option value={ALL}>All roles</option>
          {["Admin", "Dean", "Professor", "Cluster Professor", "Student"].map((item) => <option key={item}>{item}</option>)}
        </SelectField>
        <SelectField label="Event" value={eventType} onChange={(event) => setEventType(event.target.value)}>
          <option value={ALL}>All events</option>
          {EVENT_OPTIONS.map((item) => <option key={item}>{item}</option>)}
        </SelectField>
        <SelectField label="Entity" value={entityType} onChange={(event) => setEntityType(event.target.value)}>
          <option value={ALL}>All entities</option>
          {ENTITY_OPTIONS.map((item) => <option key={item}>{item}</option>)}
        </SelectField>
        <SelectField label="Sort" value={sort} onChange={(event) => setSort(event.target.value)}>
          {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
      </Card>
      <Card className="admin-panel admin-activity-panel admin-logs-table-panel">
        <div className="reports-panel-header">
          <h2><FiClock /> Audit Records</h2>
          <Button variant="light" onClick={refreshLogs}><FiRefreshCw /> Refresh</Button>
        </div>
        {logsQuery.isError ? <p className="muted">Unable to load logs: {logsQuery.error.message}</p> : null}
        {logsQuery.isFetching ? <p className="muted">Loading audit records...</p> : null}
        <Table
          columns={columns}
          emptyDescription="Try adjusting the date range, search, or filters."
          emptyTitle="No audit logs found"
          rows={rows}
          renderActions={Object.assign((row) => <Button variant="light" onClick={() => setSelectedLog(row)}><FiEye /> Details</Button>, { width: "10%" })}
        />
        <ListPagination count={count} page={page} pageSize={AUDIT_LOG_PAGE_SIZE} onPage={setPage} />
      </Card>
      {selectedLog ? (
        <div className="modal-backdrop" onClick={() => setSelectedLog(null)}>
          <Card className="modal audit-log-modal" onClick={(event) => event.stopPropagation()}>
            <PageHeader title="Log Details" actions={<Button variant="light" onClick={() => setSelectedLog(null)}>Close</Button>} />
            <dl className="audit-log-details">
              <div><dt>Timestamp</dt><dd>{selectedLog.createdAt}</dd></div>
              <div><dt>Actor</dt><dd>{selectedLog.actor}</dd></div>
              <div><dt>Role</dt><dd>{selectedLog.role}</dd></div>
              <div><dt>Event Type</dt><dd>{selectedLog.eventType}</dd></div>
              <div><dt>Action</dt><dd>{selectedLog.action}</dd></div>
              <div><dt>Entity</dt><dd>{selectedLog.entity}</dd></div>
              <div><dt>Target User</dt><dd>{selectedLog.targetUserId || "-"}</dd></div>
              <div><dt>Description</dt><dd>{selectedLog.description}</dd></div>
            </dl>
            <h3>Safe Metadata</h3>
            <pre className="audit-log-metadata">{JSON.stringify(sanitizeAuditMetadata(selectedLog.metadata), null, 2)}</pre>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
