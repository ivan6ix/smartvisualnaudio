import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FiActivity, FiBookOpen, FiFileText, FiUsers, FiX } from "react-icons/fi";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Button, Card, EmptyState, PageHeader, SearchBox, SelectField, StatCard, Table } from "../../components/ui";
import { useChartTheme } from "../../context/ThemeContext";
import { violationChart } from "../../data/mockData";
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

const dateRanges = ["All Time", "Today", "Last 7 Days", "Last 30 Days"];
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

function getRangeStart(range) {
  const now = new Date();
  if (range === "Today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === "Last 7 Days") return now.getTime() - 7 * 24 * 60 * 60 * 1000;
  if (range === "Last 30 Days") return now.getTime() - 30 * 24 * 60 * 60 * 1000;
  return 0;
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

      const [profilesResponse, examsResponse] = await Promise.all([
        studentIds.length ? supabase.from("profiles").select("id, full_name, student_number, email").in("id", studentIds) : Promise.resolve({ data: [] }),
        examIds.length ? supabase.from("exams").select("id, title, exam_title, course_id, course").in("id", examIds) : Promise.resolve({ data: [] }),
      ]);
      if (profilesResponse.error) throw profilesResponse.error;
      if (examsResponse.error) throw examsResponse.error;

      const courseIds = [...new Set((examsResponse.data || []).map((exam) => exam.course_id).filter(Boolean))];
      const coursesResponse = courseIds.length
        ? await supabase.from("courses").select("id, course_name, course_code").in("id", courseIds)
        : { data: [] };
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
          violationType: violationLabels[violation.violation_type] || violation.violation_type || "Monitoring Alert",
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
  const stats = hasSupabaseConfig ? dashboardQuery.data?.stats || defaultStats : defaultStats;
  const violations = hasSupabaseConfig ? dashboardQuery.data?.violations || emptyViolations : emptyViolations;

  const filteredViolations = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rangeStart = getRangeStart(dateRange);

    return violations.filter((violation) => {
      const matchesDate = !rangeStart || violation.timestamp >= rangeStart;
      const matchesCourse = courseFilter === "All Courses" || violation.course === courseFilter;
      const matchesExam = examFilter === "All Exams" || violation.exam === examFilter;
      const matchesType = typeFilter === "All Violations" || violation.violationType === typeFilter;
      const matchesSeverity = severityFilter === "All Severities" || violation.severity === severityFilter;
      const matchesSearch = !term || [
        violation.student,
        violation.studentNumber,
        violation.course,
        violation.exam,
        violation.violationType,
        violation.description,
      ].join(" ").toLowerCase().includes(term);

      return matchesDate && matchesCourse && matchesExam && matchesType && matchesSeverity && matchesSearch;
    });
  }, [courseFilter, dateRange, examFilter, search, severityFilter, typeFilter, violations]);

  const violationData = hasSupabaseConfig
    ? Object.entries(violationLabels).map(([key, name]) => ({
        name,
        count: filteredViolations.filter((violation) => violation.violationKey === key).length,
      }))
    : violationChart;

  const courseOptions = [...new Set(violations.map((violation) => violation.course).filter((course) => course && course !== "-"))];
  const examOptions = [...new Set(violations
    .filter((violation) => courseFilter === "All Courses" || violation.course === courseFilter)
    .map((violation) => violation.exam)
    .filter((exam) => exam && exam !== "Unknown exam"))];
  const typeOptions = [...new Set(violations.map((violation) => violation.violationType).filter(Boolean))];
  const severityOptions = [...new Set(violations.map((violation) => violation.severity).filter(Boolean))];

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

  return (
    <>
      <PageHeader title="Dean Dashboard" subtitle="Monitor students, courses, exams, and proctoring violations." />
      <Card className="dean-dashboard-controls">
        <div className="dean-dashboard-search-row">
          <SearchBox value={search} onChange={setSearch} placeholder="Search students, exams, courses, or violations..." />
          {search ? <Button variant="light" onClick={() => setSearch("")}><FiX /> Clear</Button> : null}
        </div>
        <div className="dean-dashboard-filters">
          <SelectField label="Date Range" value={dateRange} onChange={(event) => setDateRange(event.target.value)}>
            {dateRanges.map((range) => <option key={range}>{range}</option>)}
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
      <div className="stats-grid dean-stats-grid">
        {cards.map(([label, value, icon]) => <StatCard key={label} label={label} value={value} icon={icon} />)}
      </div>
      <Card>
        <div className="dean-dashboard-section-header">
          <h2>Violation Analytics</h2>
          <span>{filteredViolations.length} matching records</span>
        </div>
        <div className="chart-box">
          {filteredViolations.length || !hasSupabaseConfig ? (
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
        {hasSupabaseConfig ? <Table columns={violationColumns} rows={filteredViolations} emptyTitle="No matching records found." emptyDescription="Adjust the search or filters to show violation records." /> : null}
      </Card>
    </>
  );
}
