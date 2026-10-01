import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FiActivity, FiBookOpen, FiDatabase, FiFileText, FiUsers } from "react-icons/fi";
import { Card, Table, Badge } from "../components/ui";
import { useChartTheme } from "../context/ThemeContext";
import { logs, violationChart } from "../data/mockData";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

const defaultStats = {
  professors: 32,
  students: 1248,
  courses: 42,
  activeExams: 7,
  violationsToday: 23,
  deans: 4,
};

const defaultHealth = {
  database: "Checking",
  realtime: "Checking",
  storage: "Checking",
};

const violationLabels = {
  MULTIPLE_FACE: "Multiple Face",
  NO_FACE: "No Face",
  BACKGROUND_VOICE: "Background Voice",
  TAB_SWITCH: "Tab Switch",
  COPY_ATTEMPT: "Copy Attempt",
  FULLSCREEN_EXIT: "Fullscreen Exit",
  LOOKING_AWAY: "Looking Away",
  PHONE_DETECTED: "Cellphone Detected",
  GADGET_DETECTED: "Spare Gadget Detected",
};

async function countRows(query) {
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

export default function Dashboard() {
  const chartTheme = useChartTheme();
  const [systemHealth, setSystemHealth] = useState(defaultHealth);

  const statsQuery = useQuery({
    queryKey: ["admin-dashboard-stats"],
    enabled: hasSupabaseConfig,
    queryFn: async () => {
        const today = new Date().toISOString().slice(0, 10);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowIso = tomorrow.toISOString().slice(0, 10);

        const [professors, students, courses, activeExams, violationsToday, deans] = await Promise.all([
          countRows(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "Professor")),
          countRows(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "Student")),
          countRows(supabase.from("courses").select("id", { count: "exact", head: true }).eq("archived", false)),
          countRows(supabase.from("exams").select("id", { count: "exact", head: true }).in("status", ["Active", "Published"])),
          countRows(supabase.from("violations").select("id", { count: "exact", head: true }).gte("created_at", today).lt("created_at", tomorrowIso)),
          countRows(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "Dean")),
        ]);

      return { professors, students, courses, activeExams, violationsToday, deans };
    },
  });

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setSystemHealth({ database: "Demo", realtime: "Demo", storage: "Demo" });
      return undefined;
    }

    let active = true;

    async function loadSystemHealth() {
      const [{ error: databaseError }, { data: buckets, error: storageError }] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }).limit(1),
        supabase.storage.listBuckets(),
      ]);

      if (!active) return;
      setSystemHealth((current) => ({
        ...current,
        database: databaseError ? "Offline" : "Online",
        storage: storageError ? "Unavailable" : `${(buckets || []).length} buckets`,
      }));
    }

    loadSystemHealth();

    const channel = supabase
      .channel("admin-dashboard-health")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {})
      .subscribe((status) => {
        if (!active) return;
        setSystemHealth((current) => ({
          ...current,
          realtime: status === "SUBSCRIBED" ? "Connected" : status === "CHANNEL_ERROR" || status === "TIMED_OUT" ? "Disconnected" : "Connecting",
        }));
      });

    const refreshTimer = window.setInterval(loadSystemHealth, 30000);

    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, []);

  const detailsQuery = useQuery({
    queryKey: ["admin-dashboard-details"],
    enabled: hasSupabaseConfig,
    queryFn: async () => {
      const [{ data: violationRows, error: violationsError }, { data: examRows, error: examsError }, { data: logRows, error: logsError }] = await Promise.all([
        supabase.from("violations").select("violation_type").limit(500),
        supabase
          .from("exams")
          .select("id, title, exam_title, course, duration, time_limit, status, courses(course_name)")
          .in("status", ["Active", "Published", "Scheduled"])
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("logs")
          .select("id, action, description, created_at")
          .order("created_at", { ascending: false })
          .limit(8),
      ]);

      if (violationsError) throw violationsError;
      if (examsError) throw examsError;
      if (logsError) throw logsError;
      const counts = (violationRows || []).reduce((items, row) => {
        items[row.violation_type] = (items[row.violation_type] || 0) + 1;
        return items;
      }, {});
      return {
        violationChart: Object.entries(violationLabels).map(([key, name]) => ({ name, count: counts[key] || 0 })),
        exams: (examRows || []).map((exam) => ({
          id: exam.id,
          title: exam.exam_title || exam.title,
          course: exam.courses?.course_name || exam.course || "Unassigned course",
          duration: exam.time_limit || exam.duration,
          status: exam.status,
        })),
        logs: (logRows || []).map((log) => ({
          id: log.id,
          action: log.action,
          description: log.description,
          createdAt: new Date(log.created_at).toLocaleString(),
        })),
      };
    },
  });

  const liveStats = hasSupabaseConfig ? statsQuery.data || defaultStats : defaultStats;
  const liveViolationChart = hasSupabaseConfig ? detailsQuery.data?.violationChart || violationChart : violationChart;
  const liveLogs = hasSupabaseConfig ? detailsQuery.data?.logs || logs : logs;

  const stats = [
    ["Total Professors", liveStats.professors, FiUsers],
    ["Total Students", liveStats.students, FiUsers],
    ["Total Courses", liveStats.courses, FiBookOpen],
    ["Active Exams", liveStats.activeExams, FiFileText],
    ["Violations Today", liveStats.violationsToday, FiActivity],
    ["Dean Accounts", liveStats.deans, FiUsers],
  ];

  return (
    <section className="admin-dashboard-page">
      <div className="admin-dashboard-header">
        <span>Welcome back</span>
        <div>
          <h1>System Overview</h1>
          <p>Monitor users, courses, exams, and system integrity.</p>
        </div>
      </div>

      <div className="admin-stats-grid">
        {stats.map(([label, value, Icon]) => (
          <article className="admin-stat-card" key={label}>
            <Icon />
            <div>
              <strong>{Number(value).toLocaleString()}</strong>
              <span>{label}</span>
            </div>
          </article>
        ))}
      </div>

      <div className="admin-dashboard-grid">
        <Card className="admin-panel admin-chart-panel">
          <div className="admin-panel-title">
            <span><FiActivity /> Violation Analytics</span>
            <small>Face, audio, fullscreen, and device alerts</small>
          </div>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={liveViolationChart}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: chartTheme.axis }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: chartTheme.axis }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: chartTheme.cursor }} contentStyle={{ background: chartTheme.tooltipBackground, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 8, color: chartTheme.tooltipText }} itemStyle={{ color: chartTheme.tooltipText }} labelStyle={{ color: chartTheme.tooltipText }} />
                <Bar dataKey="count" fill="var(--primary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="admin-panel admin-health-panel">
          <div className="admin-panel-title">
            <span><FiDatabase /> System Health</span>
            <small>Supabase services</small>
          </div>
          <div className="health-list admin-health-list">
            <span>
              <FiDatabase />
              <strong>Database Status</strong>
              <Badge tone={systemHealth.database === "Online" ? "success" : systemHealth.database === "Checking" ? "warn" : "danger"}>{systemHealth.database}</Badge>
            </span>
            <span>
              <FiActivity />
              <strong>Realtime Status</strong>
              <Badge tone={systemHealth.realtime === "Connected" ? "success" : systemHealth.realtime === "Checking" || systemHealth.realtime === "Connecting" ? "warn" : "danger"}>{systemHealth.realtime}</Badge>
            </span>
            <span>
              <FiDatabase />
              <strong>Storage Buckets</strong>
              <Badge tone={systemHealth.storage === "Unavailable" ? "danger" : systemHealth.storage === "Checking" ? "warn" : "success"}>{systemHealth.storage}</Badge>
            </span>
          </div>
        </Card>
      </div>

      <Card className="admin-panel admin-activity-panel">
        <div className="admin-panel-title">
          <span><FiUsers /> Recent Account Activity</span>
          <small>Admin, course, account, and password events</small>
        </div>
        <Table columns={[{ key: "action", label: "Action" }, { key: "description", label: "Description" }, { key: "createdAt", label: "Date" }]} rows={liveLogs} />
      </Card>
    </section>
  );
}
