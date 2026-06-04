import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FiActivity, FiBookOpen, FiDatabase, FiFileText, FiPlus, FiUsers } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { Card, PageHeader, QuickAction, StatCard, Table, Badge } from "../components/ui";
import { exams, logs, violationChart } from "../data/mockData";
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
  const navigate = useNavigate();
  const [liveStats, setLiveStats] = useState(defaultStats);
  const [liveViolationChart, setLiveViolationChart] = useState(violationChart);
  const [liveExams, setLiveExams] = useState(exams);
  const [liveLogs, setLiveLogs] = useState(logs);
  const [systemHealth, setSystemHealth] = useState(defaultHealth);

  useEffect(() => {
    if (!hasSupabaseConfig) return;

    async function loadStats() {
      try {
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

        setLiveStats({ professors, students, courses, activeExams, violationsToday, deans });
      } catch {
        setLiveStats(defaultStats);
      }
    }

    loadStats();
  }, []);

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

  useEffect(() => {
    if (!hasSupabaseConfig) return;

    async function loadDashboardDetails() {
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

      if (!violationsError) {
        const counts = (violationRows || []).reduce((items, row) => {
          items[row.violation_type] = (items[row.violation_type] || 0) + 1;
          return items;
        }, {});
        setLiveViolationChart(Object.entries(violationLabels).map(([key, name]) => ({ name, count: counts[key] || 0 })));
      }

      if (!examsError) {
        setLiveExams((examRows || []).map((exam) => ({
          id: exam.id,
          title: exam.exam_title || exam.title,
          course: exam.courses?.course_name || exam.course || "Unassigned course",
          duration: exam.time_limit || exam.duration,
          status: exam.status,
        })));
      }

      if (!logsError) {
        setLiveLogs((logRows || []).map((log) => ({
          id: log.id,
          action: log.action,
          description: log.description,
          createdAt: new Date(log.created_at).toLocaleString(),
        })));
      }
    }

    loadDashboardDetails();
  }, []);

  const stats = [
    ["Total Professors", liveStats.professors, FiUsers],
    ["Total Students", liveStats.students, FiUsers],
    ["Total Courses", liveStats.courses, FiBookOpen],
    ["Active Exams", liveStats.activeExams, FiFileText],
    ["Violations Today", liveStats.violationsToday, FiActivity],
    ["Dean Accounts", liveStats.deans, FiUsers],
  ];

  return (
    <>
      <PageHeader title="Admin Dashboard" subtitle="Realtime overview for account, exam, and monitoring operations." />
      <div className="stats-grid">{stats.map(([label, value, icon]) => <StatCard key={label} label={label} value={value} icon={icon} />)}</div>
      <div className="dashboard-grid">
        <Card>
          <h2>Quick Actions</h2>
          <div className="quick-grid">
            <QuickAction icon={FiPlus} onClick={() => navigate("/create-account")}>Create Account</QuickAction>
            <QuickAction icon={FiPlus} onClick={() => navigate("/courses")}>Create Course</QuickAction>
            <QuickAction icon={FiUsers} onClick={() => navigate("/accounts")}>Manage Accounts</QuickAction>
            <QuickAction icon={FiFileText} onClick={() => navigate("/reports")}>View Reports</QuickAction>
          </div>
        </Card>
        <Card>
          <h2>System Health Status</h2>
          <div className="health-list">
            <span>
              <FiDatabase />
              Database Status
              <Badge tone={systemHealth.database === "Online" ? "success" : systemHealth.database === "Checking" ? "warn" : "danger"}>{systemHealth.database}</Badge>
            </span>
            <span>
              <FiActivity />
              Realtime Status
              <Badge tone={systemHealth.realtime === "Connected" ? "success" : systemHealth.realtime === "Checking" || systemHealth.realtime === "Connecting" ? "warn" : "danger"}>{systemHealth.realtime}</Badge>
            </span>
            <span>
              <FiDatabase />
              Storage Buckets
              <Badge tone={systemHealth.storage === "Unavailable" ? "danger" : systemHealth.storage === "Checking" ? "warn" : "success"}>{systemHealth.storage}</Badge>
            </span>
          </div>
        </Card>
      </div>
      <div className="dashboard-grid">
        <Card>
          <h2>Violation Analytics</h2>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={liveViolationChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#111111" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="active-exams-card">
          <h2>Active Exams</h2>
          <div className="scroll-list">
            {liveExams.slice(0, 5).map((exam) => <span key={exam.id}><strong>{exam.title}</strong><small>{exam.course} - {exam.duration} minutes</small><Badge>{exam.status}</Badge></span>)}
            {!liveExams.length ? <div className="empty-state">No active exams found.</div> : null}
          </div>
          <button className="text-button">View More</button>
        </Card>
      </div>
      <Card>
        <h2>Recent Account Activity</h2>
        <Table columns={[{ key: "action", label: "Action" }, { key: "description", label: "Description" }, { key: "createdAt", label: "Date" }]} rows={liveLogs} />
      </Card>
    </>
  );
}
