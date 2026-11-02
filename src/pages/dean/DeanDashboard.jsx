import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FiActivity, FiBookOpen, FiFileText, FiUsers, FiX } from "react-icons/fi";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ListPagination, ListViewToolbar, RecordCardList } from "../../components/ListViewControls";
import { Badge, Button, Card, EmptyState, ListSkeleton, SearchBox, SelectField, SkeletonBlock, SkeletonValue, Table } from "../../components/ui";
import { useChartTheme } from "../../context/ThemeContext";
import useListViewPreference from "../../hooks/useListViewPreference";
import { violationChart } from "../../data/mockData";
import { fetchRowsByIds } from "../../lib/fetchAllRows";
import { getListPageSlice } from "../../lib/listView";
import { VIOLATION_DATE_RANGES, filterViolations, violationFilterOptions } from "../../lib/violationFilters";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

const defaultStats = {
  students: 0,
  courses: 0,
  activeExams: 0,
  violationsToday: 0,
};

const violationLabels = {
  MULTIPLE_FACE: "Multiple Face",
  NO_FACE: "No Face",
  BACKGROUND_VOICE: "Background Voice",
  LOUD_NOISE_DETECTED: "Background Voice",
  AUDIO_DETECTED: "Background Voice",
  LOUD_AUDIO: "Loud Audio",
  TAB_SWITCH: "Tab Switch",
  COPY_ATTEMPT: "Copy Attempt",
  FULLSCREEN_EXIT: "Fullscreen Exit",
  LOOKING_AWAY: "Looking Away",
  PHONE_DETECTED: "Cellphone Detected",
  GADGET_DETECTED: "Spare Gadget Detected",
};

// Activity labels only; not chart categories.
const deviceViolationLabels = {
  MICROPHONE_UNAVAILABLE: "Microphone Unavailable",
  MICROPHONE_DISCONNECTED: "Microphone Disconnected",
  MICROPHONE_MUTED: "Microphone Muted or Silent",
  MICROPHONE_ACCESS_LOST: "Microphone Access Lost",
};

const emptyViolations = [];

async function countRows(query) {
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

function formatDateTime(value) {
  if (!value) return { date: "-", time: "-", timestamp: 0 };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "-", time: "-", timestamp: 0 };
  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    timestamp: date.getTime(),
  };
}

function severityTone(severity) {
  if (severity === "High") return "danger";
  if (severity === "Medium") return "warn";
  return "neutral";
}

export default function DeanDashboard() {
  const chartTheme = useChartTheme();
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState("All Time");
  const [courseFilter, setCourseFilter] = useState("All Courses");
  const [examFilter, setExamFilter] = useState("All Exams");
  const [typeFilter, setTypeFilter] = useState("All Violations");
  const [severityFilter, setSeverityFilter] = useState("All Severities");
  const [page, setPage] = useState(1);
  const listView = useListViewPreference({ role: "dean", page: "dashboard-violations", defaultView: "table" });
  const dashboardQuery = useQuery({
    queryKey: ["dean-dashboard"],
    enabled: hasSupabaseConfig,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowIso = tomorrow.toISOString().slice(0, 10);

      const [students, courses, activeExams, violationsToday, violationsResponse] = await Promise.all([
          countRows(supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "Student")),
          countRows(supabase.from("courses").select("id", { count: "exact", head: true }).eq("archived", false)),
          countRows(supabase.from("exams").select("id", { count: "exact", head: true }).in("status", ["Active", "Published"])),
          countRows(supabase.from("violations").select("id", { count: "exact", head: true }).gte("created_at", today).lt("created_at", tomorrowIso)),
          supabase.from("violations").select("id, student_id, exam_id, violation_type, severity, description, created_at").order("created_at", { ascending: false }).limit(500),
      ]);
      if (violationsResponse.error) throw violationsResponse.error;

      const violations = violationsResponse.data || [];
      const studentIds = [...new Set(violations.map((row) => row.student_id).filter(Boolean))];
      const examIds = [...new Set(violations.map((row) => row.exam_id).filter(Boolean))];

      // Looked up in batches of ids, so the request address stays short however many alerts there are.
      const [profilesResponse, examsResponse] = await Promise.all([
        fetchRowsByIds(studentIds, (ids, options) => supabase.from("profiles").select("id, full_name, student_number, email", options).in("id", ids).order("id")),
        fetchRowsByIds(examIds, (ids, options) => supabase.from("exams").select("id, title, exam_title, course_id, course", options).in("id", ids).order("id")),
      ]);
      if (profilesResponse.error) throw profilesResponse.error;
      if (examsResponse.error) throw examsResponse.error;

      const courseIds = [...new Set((examsResponse.data || []).map((exam) => exam.course_id).filter(Boolean))];
      const coursesResponse = await fetchRowsByIds(courseIds, (ids, options) => supabase.from("courses").select("id, course_name, course_code", options).in("id", ids).order("id"));
      if (coursesResponse.error) throw coursesResponse.error;

      const profilesById = new Map((profilesResponse.data || []).map((profile) => [profile.id, profile]));
      const examsById = new Map((examsResponse.data || []).map((exam) => [exam.id, exam]));
      const coursesById = new Map((coursesResponse.data || []).map((course) => [course.id, course]));
      const violationRows = violations.map((violation) => {
        const profile = profilesById.get(violation.student_id);
        const exam = examsById.get(violation.exam_id);
        const course = exam?.course_id ? coursesById.get(exam.course_id) : null;
        const { date, time, timestamp } = formatDateTime(violation.created_at);

        return {
          id: violation.id,
          student: profile?.full_name || profile?.email || "Unknown student",
          studentNumber: profile?.student_number || "-",
          course: course?.course_code || course?.course_name || exam?.course || "-",
          courseId: course?.id || "",
          exam: exam?.exam_title || exam?.title || "Unknown exam",
          examId: exam?.id || "",
          violationType: violationLabels[violation.violation_type] || deviceViolationLabels[violation.violation_type] || violation.violation_type || "Monitoring Alert",
          violationKey: violation.violation_type || "",
          description: violation.description || "-",
          severity: violation.severity || "Low",
          date,
          time,
          timestamp,
        };
      });

      return {
        stats: { students, courses, activeExams, violationsToday },
        violations: violationRows,
      };
    },
  });
  const dashboardLoading = hasSupabaseConfig && dashboardQuery.isLoading;
  const stats = hasSupabaseConfig ? dashboardQuery.data?.stats || defaultStats : defaultStats;
  const violations = hasSupabaseConfig ? dashboardQuery.data?.violations || emptyViolations : emptyViolations;

  const filteredViolations = useMemo(() => filterViolations(violations, {
    search,
    dateRange,
    course: courseFilter,
    exam: examFilter,
    type: typeFilter,
    severity: severityFilter,
  }), [courseFilter, dateRange, examFilter, search, severityFilter, typeFilter, violations]);

  const violationData = hasSupabaseConfig
    ? Object.entries(violationLabels).map(([key, name]) => ({
        name,
        count: filteredViolations.filter((violation) => violation.violationKey === key).length,
      }))
    : violationChart;

  const { courses: courseOptions, exams: examOptions, types: typeOptions, severities: severityOptions } = violationFilterOptions(violations, courseFilter);

  function resetFilters() {
    setSearch("");
    setDateRange("All Time");
    setCourseFilter("All Courses");
    setExamFilter("All Exams");
    setTypeFilter("All Violations");
    setSeverityFilter("All Severities");
  }

  const cards = [
    ["Total Students", stats.students, FiUsers],
    ["Total Courses", stats.courses, FiBookOpen],
    ["Active Exams", stats.activeExams, FiFileText],
    ["Violations Today", stats.violationsToday, FiActivity],
  ];
  const violationColumns = [
    { key: "student", label: "Student" },
    { key: "studentNumber", label: "Student ID" },
    { key: "course", label: "Course" },
    { key: "exam", label: "Exam" },
    { key: "violationType", label: "Violation" },
    { key: "severity", label: "Severity", render: (row) => <Badge tone={severityTone(row.severity)}>{row.severity}</Badge> },
    { key: "date", label: "Date" },
    { key: "time", label: "Time" },
  ];
  const pageData = getListPageSlice(filteredViolations, page, listView.pageSize);

  return (
    <section className="dean-dashboard-page">
      <header className="dean-dashboard-header">
        <h1>Dashboard</h1>
        <p>Overview of examination activity, integrity monitoring, and oversight records.</p>
      </header>
      <div className="dean-kpi-grid">
        {cards.map(([label, value, Icon]) => (
          <Card className="dean-kpi-card" key={label}>
            <div>
              <span>{label}</span>
              <strong>{dashboardLoading ? <SkeletonValue /> : value}</strong>
            </div>
            <Icon />
          </Card>
        ))}
      </div>
      <Card className="dean-dashboard-panel dean-dashboard-controls">
        <div className="dean-dashboard-search-row">
          <SearchBox value={search} onChange={setSearch} placeholder="Search students, exams, courses, or violations..." />
          {search ? <Button variant="light" onClick={() => setSearch("")}><FiX /> Clear</Button> : null}
        </div>
        <div className="dean-dashboard-filters">
          <SelectField label="Date Range" value={dateRange} onChange={(event) => setDateRange(event.target.value)}>
            {VIOLATION_DATE_RANGES.map((range) => <option key={range}>{range}</option>)}
          </SelectField>
          <SelectField label="Course" value={courseFilter} onChange={(event) => { setCourseFilter(event.target.value); setExamFilter("All Exams"); }}>
            <option>All Courses</option>
            {courseOptions.map((course) => <option key={course}>{course}</option>)}
          </SelectField>
          <SelectField label="Exam" value={examFilter} onChange={(event) => setExamFilter(event.target.value)}>
            <option>All Exams</option>
            {examOptions.map((exam) => <option key={exam}>{exam}</option>)}
          </SelectField>
          <SelectField label="Violation Type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option>All Violations</option>
            {typeOptions.map((type) => <option key={type}>{type}</option>)}
          </SelectField>
          <SelectField label="Severity" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
            <option>All Severities</option>
            {severityOptions.map((severity) => <option key={severity}>{severity}</option>)}
          </SelectField>
          <Button variant="light" onClick={resetFilters}>Reset Filters</Button>
        </div>
      </Card>
      <Card className="dean-dashboard-panel dean-analytics-panel">
        <div className="dean-dashboard-section-header">
          <div>
            <h2>Violation Analytics</h2>
            <p>Filtered proctoring records from the current Dean dashboard sample.</p>
          </div>
          <span>{dashboardLoading ? <SkeletonValue /> : `${filteredViolations.length} matching records`}</span>
        </div>
        <div className="chart-box dean-chart-box">
          {dashboardLoading ? <SkeletonBlock className="skeleton-chart" /> : filteredViolations.length || !hasSupabaseConfig ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={violationData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                <XAxis axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} dataKey="name" tick={{ fontSize: 11, fill: chartTheme.axis }} />
                <YAxis axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} tick={{ fill: chartTheme.axis }} />
                <Tooltip cursor={{ fill: chartTheme.cursor }} contentStyle={{ background: chartTheme.tooltipBackground, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 14, color: chartTheme.tooltipText }} itemStyle={{ color: chartTheme.tooltipText }} labelStyle={{ color: chartTheme.tooltipText }} />
                <Bar dataKey="count" fill="#06b6d4" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No matching records found." description="Adjust the search or filters to show analytics." />}
        </div>
        {hasSupabaseConfig ? (
          <>
            <ListViewToolbar
              controls={{
                cardDensity: listView.cardDensity,
                onCardDensity: listView.setCardDensity,
                onTableDensity: listView.setTableDensity,
                onView: (nextView) => setPage(listView.switchViewPreservingPage(nextView, pageData.page, filteredViolations.length)),
                tableDensity: listView.tableDensity,
                view: listView.view,
              }}
            />
            {dashboardLoading ? (
              <ListSkeleton columns={listView.view === "cards" ? 4 : 8} label="Loading violation records..." variant={listView.view === "cards" ? "records" : "table"} />
            ) : listView.view === "cards" ? (
              <RecordCardList columns={violationColumns} density={listView.cardDensity} rows={pageData.rows} titleKey="student" />
            ) : (
              <Table className={`dean-dashboard-violations-table list-table-${listView.tableDensity}`} columns={violationColumns} rows={pageData.rows} emptyTitle="No matching records found." emptyDescription="Adjust the search or filters to show violation records." />
            )}
            <ListPagination count={filteredViolations.length} page={pageData.page} pageSize={listView.pageSize} onPage={setPage} />
          </>
        ) : null}
      </Card>
    </section>
  );
}
