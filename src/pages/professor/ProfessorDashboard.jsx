import { useEffect, useMemo, useState } from "react";
import { FiActivity, FiBookOpen, FiFileText, FiMonitor } from "react-icons/fi";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Badge, Card, PageHeader, StatCard } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { professorAlerts, professorCourses, professorExams } from "../../data/professorData";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

const violationLabels = {
  MULTIPLE_FACE: "Multiple face detected",
  NO_FACE: "No face detected",
  BACKGROUND_VOICE: "Background voice detected",
  AUDIO_DETECTED: "Background voice detected",
  LOUD_AUDIO: "Background voice detected",
  LOUD_NOISE_DETECTED: "Background voice detected",
  TAB_SWITCH: "Tab switch attempt",
  COPY_ATTEMPT: "Copy attempt detected",
  FULLSCREEN_EXIT: "Fullscreen exit detected",
  LOOKING_AWAY: "Looking away repeatedly",
  PHONE_DETECTED: "Cellphone detected",
  GADGET_DETECTED: "Spare gadget detected",
};

const violationChartLabels = {
  MULTIPLE_FACE: "Multiple Face",
  BACKGROUND_VOICE: "Background Voice",
  COPY_ATTEMPT: "Copy Attempt",
  LOOKING_AWAY: "Looking Away",
  GADGET_DETECTED: "Spare Gadget Detected",
};

const violationChartGroups = {
  AUDIO_DETECTED: "BACKGROUND_VOICE",
  LOUD_AUDIO: "BACKGROUND_VOICE",
  LOUD_NOISE_DETECTED: "BACKGROUND_VOICE",
  PHONE_DETECTED: "GADGET_DETECTED",
};

function severityTone(severity) {
  if (severity === "High") return "danger";
  if (severity === "Medium") return "warn";
  return "neutral";
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function mapAlert(violation) {
  const exam = violation.exams;
  const student = violation.profiles;

  return {
    id: violation.id,
    exam: exam?.exam_title || exam?.title || "Unknown exam",
    student: student?.full_name || "Unknown student",
    activity: violationLabels[violation.violation_type] || violation.violation_type || "Monitoring alert",
    severity: violation.severity || "Low",
    time: formatTime(violation.created_at),
  };
}

async function countRows(query) {
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

export default function ProfessorDashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    courses: hasSupabaseConfig ? 0 : professorCourses.length,
    exams: hasSupabaseConfig ? 0 : professorExams.length,
    published: hasSupabaseConfig ? 0 : professorExams.filter((exam) => exam.status === "Published").length,
    alerts: hasSupabaseConfig ? 0 : professorAlerts.length,
  });
  const [liveAlerts, setLiveAlerts] = useState(hasSupabaseConfig ? [] : professorAlerts);
  const [professorExamRows, setProfessorExamRows] = useState([]);
  const [violationRows, setViolationRows] = useState([]);
  const [analyticsFilters, setAnalyticsFilters] = useState({
    course: "All Courses",
    section: "All Sections",
    exam: "All Exams",
  });

  useEffect(() => {
    if (!hasSupabaseConfig || !user?.id) return;

    async function loadDashboard() {
      try {
        const [coursesCount, examsCount, publishedCount, allExamIdsResponse] = await Promise.all([
          countRows(supabase.from("courses").select("id", { count: "exact", head: true }).eq("professor_id", user.id).eq("archived", false)),
          countRows(supabase.from("exams").select("id", { count: "exact", head: true }).or(`professor_id.eq.${user.id},created_by.eq.${user.id}`)),
          countRows(supabase.from("exams").select("id", { count: "exact", head: true }).or(`professor_id.eq.${user.id},created_by.eq.${user.id}`).in("status", ["Published", "published", "Active", "active"])),
          supabase
            .from("exams")
            .select("id, title, exam_title, course_id, courses(course_name, course_code, section)")
            .or(`professor_id.eq.${user.id},created_by.eq.${user.id}`)
            .limit(1000),
        ]);

        if (allExamIdsResponse.error) throw allExamIdsResponse.error;

        const examRows = allExamIdsResponse.data || [];
        const examIds = examRows.map((exam) => exam.id);
        const alertsCount = examIds.length
          ? await countRows(supabase.from("violations").select("id", { count: "exact", head: true }).in("exam_id", examIds))
          : 0;

        setStats({
          courses: coursesCount,
          exams: examsCount,
          published: publishedCount,
          alerts: alertsCount,
        });
        if (!examIds.length) {
          setLiveAlerts([]);
          setProfessorExamRows([]);
          setViolationRows([]);
          return;
        }

        const { data: violationRows, error: violationsError } = await supabase
          .from("violations")
          .select("id, exam_id, violation_type, severity, created_at, profiles:student_id(full_name), exams(id, title, exam_title)")
          .in("exam_id", examIds)
          .order("created_at", { ascending: false })
          .limit(500);

        if (violationsError) throw violationsError;
        const violations = violationRows || [];
        setProfessorExamRows(examRows);
        setViolationRows(violations);
        setLiveAlerts(violations.slice(0, 8).map(mapAlert));
      } catch (error) {
        toast.error(error.message);
      }
    }

    loadDashboard();
    const channel = supabase
      .channel(`professor-dashboard-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "violations" }, () => {
        void loadDashboard();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "exams" }, () => {
        void loadDashboard();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const statCards = [
    ["My Courses", stats.courses, FiBookOpen],
    ["Created Exams", stats.exams, FiFileText],
    ["Published Exams", stats.published, FiActivity],
    ["Total Alerts", stats.alerts, FiMonitor],
  ];

  const examById = useMemo(() => new Map(professorExamRows.map((exam) => [exam.id, exam])), [professorExamRows]);
  const courseOptions = useMemo(() => [...new Set(professorExamRows.map((exam) => exam.courses?.course_code || exam.courses?.course_name).filter(Boolean))].sort(), [professorExamRows]);
  const sectionOptions = useMemo(() => [...new Set(professorExamRows
    .filter((exam) => analyticsFilters.course === "All Courses" || exam.courses?.course_code === analyticsFilters.course || exam.courses?.course_name === analyticsFilters.course)
    .map((exam) => exam.courses?.section)
    .filter(Boolean))].sort(), [analyticsFilters.course, professorExamRows]);
  const examOptions = useMemo(() => professorExamRows
    .filter((exam) => analyticsFilters.course === "All Courses" || exam.courses?.course_code === analyticsFilters.course || exam.courses?.course_name === analyticsFilters.course)
    .filter((exam) => analyticsFilters.section === "All Sections" || exam.courses?.section === analyticsFilters.section)
    .sort((first, second) => (first.exam_title || first.title || "").localeCompare(second.exam_title || second.title || "")), [analyticsFilters.course, analyticsFilters.section, professorExamRows]);
  const filteredViolationRows = useMemo(() => violationRows.filter((violation) => {
    const exam = examById.get(violation.exam_id);
    if (!exam) return false;
    const course = exam.courses?.course_code || exam.courses?.course_name || "";
    const section = exam.courses?.section || "";
    const matchesCourse = analyticsFilters.course === "All Courses" || course === analyticsFilters.course;
    const matchesSection = analyticsFilters.section === "All Sections" || section === analyticsFilters.section;
    const matchesExam = analyticsFilters.exam === "All Exams" || violation.exam_id === analyticsFilters.exam;
    return matchesCourse && matchesSection && matchesExam;
  }), [analyticsFilters, examById, violationRows]);
  const violationChartData = useMemo(() => {
    const counts = filteredViolationRows.reduce((items, row) => ({
      ...items,
      [violationChartGroups[row.violation_type] || row.violation_type]: (items[violationChartGroups[row.violation_type] || row.violation_type] || 0) + 1,
    }), {});
    return Object.entries(violationChartLabels).map(([key, name]) => ({ key, name, count: counts[key] || 0 }));
  }, [filteredViolationRows]);

  function setAnalyticsFilter(key, value) {
    setAnalyticsFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "course" ? { section: "All Sections", exam: "All Exams" } : {}),
      ...(key === "section" ? { exam: "All Exams" } : {}),
    }));
  }

  return (
    <>
      <PageHeader title="Professor Dashboard" subtitle="Manage courses, exams, monitoring activity, and student scores." />
      <div className="professor-stats-grid">
        {statCards.map(([label, value, icon]) => <StatCard key={label} label={label} value={value} icon={icon} />)}
      </div>
      <div className="professor-dashboard-grid">
        <Card>
          <h2>Violation Analytics</h2>
          <div className="professor-analytics-filters">
            <select aria-label="Filter analytics by course" onChange={(event) => setAnalyticsFilter("course", event.target.value)} value={analyticsFilters.course}>
              <option>All Courses</option>
              {courseOptions.map((course) => <option key={course}>{course}</option>)}
            </select>
            <select aria-label="Filter analytics by section" onChange={(event) => setAnalyticsFilter("section", event.target.value)} value={analyticsFilters.section}>
              <option>All Sections</option>
              {sectionOptions.map((section) => <option key={section}>{section}</option>)}
            </select>
            <select aria-label="Filter analytics by exam" onChange={(event) => setAnalyticsFilter("exam", event.target.value)} value={analyticsFilters.exam}>
              <option>All Exams</option>
              {examOptions.map((exam) => <option key={exam.id} value={exam.id}>{exam.exam_title || exam.title || "Untitled exam"}</option>)}
            </select>
          </div>
          <div className="chart-box professor-violation-chart">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={violationChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" />
                <XAxis dataKey="name" interval={0} tick={{ fontSize: 11, fill: "#cbd5e1" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: "#cbd5e1" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(34, 211, 238, 0.25)", borderRadius: 14, color: "#fff" }} />
                <Bar dataKey="count" fill="#06b6d4" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <h2>Live Monitoring Alerts</h2>
          <div className="professor-alert-list">
            {liveAlerts.map((alert) => (
              <article key={alert.id}>
                <div>
                  <strong>{alert.activity}</strong>
                  <small>{alert.exam} - {alert.student}</small>
                </div>
                <div>
                  <Badge tone={severityTone(alert.severity)}>{alert.severity}</Badge>
                  <time>{alert.time}</time>
                </div>
              </article>
            ))}
            {!liveAlerts.length ? <div className="empty-state">No monitoring alerts yet.</div> : null}
          </div>
        </Card>
      </div>
    </>
  );
}
