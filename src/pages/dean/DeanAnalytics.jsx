import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FiAlertTriangle, FiBarChart2, FiCheckCircle, FiFileText, FiUsers } from "react-icons/fi";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Card, EmptyState, ListSkeleton, SelectField, SkeletonBlock, SkeletonValue, Table } from "../../components/ui";
import { useChartTheme } from "../../context/ThemeContext";
import { buildDeanAnalytics } from "../../lib/deanAnalytics";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

const ALL = "All";
const SORTS = ["Section", "Lowest pass rate", "Lowest average", "Highest risk"];

function percent(value, digits = 0) {
  return value === null || value === undefined ? "-" : `${(value * 100).toFixed(digits)}%`;
}

function score(value) {
  return value === null || value === undefined ? "-" : `${value.toFixed(1)}%`;
}

async function loadAnalyticsData() {
  const [coursesResponse, programsResponse, examsResponse, attemptsResponse, violationsResponse] = await Promise.all([
    supabase.from("courses").select("id, course_code, section, course_name, semester, academic_year, program_id"),
    supabase.from("programs").select("id, program_code, program_name"),
    supabase.from("exams").select("id, course_id, status, description, passing_score").eq("status", "Published"),
    supabase.from("exam_attempts").select("id, exam_id, student_id, score, status, started_at, submitted_at").limit(20000),
    supabase.from("violations").select("exam_id, student_id, violation_type, created_at").limit(20000),
  ]);
  for (const response of [coursesResponse, examsResponse, attemptsResponse, violationsResponse]) {
    if (response.error) throw response.error;
  }
  return {
    courses: coursesResponse.data || [],
    programs: programsResponse.error ? [] : programsResponse.data || [],
    exams: examsResponse.data || [],
    attempts: attemptsResponse.data || [],
    violations: violationsResponse.data || [],
  };
}

export default function DeanAnalytics() {
  const chartTheme = useChartTheme();
  const [academicYear, setAcademicYear] = useState(ALL);
  const [semester, setSemester] = useState(ALL);
  const [programId, setProgramId] = useState(ALL);
  const [sort, setSort] = useState(SORTS[0]);
  const query = useQuery({ queryKey: ["dean-analytics"], enabled: hasSupabaseConfig, queryFn: loadAnalyticsData });
  const loading = hasSupabaseConfig && query.isLoading;
  const data = query.data;

  const analysis = useMemo(() => data ? buildDeanAnalytics({
    exams: data.exams,
    courses: data.courses,
    attempts: data.attempts,
    violations: data.violations,
    filters: {
      academicYear: academicYear === ALL ? "" : academicYear,
      semester: semester === ALL ? "" : semester,
      programId: programId === ALL ? "" : programId,
    },
  }) : null, [academicYear, data, programId, semester]);

  const programName = useMemo(() => new Map((data?.programs || []).map((program) => [program.id, program.program_code || program.program_name])), [data?.programs]);
  const sections = useMemo(() => {
    const rows = [...(analysis?.sections || [])];
    if (sort === "Lowest pass rate") rows.sort((left, right) => (left.passRate ?? 2) - (right.passRate ?? 2));
    if (sort === "Lowest average") rows.sort((left, right) => (left.averageScore ?? 1000) - (right.averageScore ?? 1000));
    if (sort === "Highest risk") rows.sort((left, right) => (right.highRiskRate ?? -1) - (left.highRiskRate ?? -1));
    return rows;
  }, [analysis?.sections, sort]);
  const chartData = (analysis?.periods || []).map((row) => ({
    period: row.period,
    "Average score": row.averageScore === null ? null : Number(row.averageScore.toFixed(1)),
    "Pass rate": row.passRate === null ? null : Math.round(row.passRate * 100),
    "Alerts per 100 attempts": row.alertsPer100 === null ? null : Math.round(row.alertsPer100),
  }));
  const kpis = analysis?.kpis;

  const columns = [
    { key: "label", label: "Section", render: (row) => <span className="dean-insights-section"><strong>{row.label}</strong><small>{row.courseName}</small></span> },
    { key: "exams", label: "Exams" },
    { key: "attempts", label: "Attempts" },
    { key: "averageScore", label: "Average", render: (row) => score(row.averageScore) },
    { key: "passRate", label: "Pass rate", render: (row) => row.flags.lowPass ? <Badge tone="warn">{percent(row.passRate)}</Badge> : percent(row.passRate) },
    { key: "highRiskRate", label: "High-risk attempts", render: (row) => row.flags.highRisk ? <Badge tone="danger">{percent(row.highRiskRate)}</Badge> : percent(row.highRiskRate) },
    { key: "alertsPerAttempt", label: "Alerts per attempt", render: (row) => row.alertsPerAttempt === null ? "-" : row.alertsPerAttempt.toFixed(1) },
  ];

  const cards = [
    ["Exams given", kpis?.exams, FiFileText],
    ["Graded attempts", kpis?.attempts, FiUsers],
    ["Average score", kpis ? score(kpis.averageScore) : "-", FiBarChart2],
    ["Pass rate", kpis ? percent(kpis.passRate) : "-", FiCheckCircle],
    ["High-risk attempts", kpis ? `${kpis.highRisk} (${percent(kpis.highRiskRate, 1)})` : "-", FiAlertTriangle],
  ];

  return (
    <section className="dean-dashboard-page dean-insights-page">
      <header className="dean-dashboard-header">
        <h1>Analytics</h1>
        <p>Exam results and integrity across periods and sections, with recommendations for follow-up.</p>
      </header>

      <Card className="dean-dashboard-panel dean-dashboard-controls">
        <div className="dean-dashboard-filters">
          <SelectField label="Academic Year" value={academicYear} onChange={(event) => setAcademicYear(event.target.value)}>
            <option>{ALL}</option>
            {(analysis?.options.academicYears || []).map((item) => <option key={item}>{item}</option>)}
          </SelectField>
          <SelectField label="Semester" value={semester} onChange={(event) => setSemester(event.target.value)}>
            <option>{ALL}</option>
            {(analysis?.options.semesters || []).map((item) => <option key={item}>{item}</option>)}
          </SelectField>
          <SelectField label="Program" value={programId} onChange={(event) => setProgramId(event.target.value)}>
            <option value={ALL}>{ALL}</option>
            {(analysis?.options.programIds || []).map((id) => <option key={id} value={id}>{programName.get(id) || "Unnamed program"}</option>)}
          </SelectField>
        </div>
      </Card>

      {query.error ? (
        <Card className="dean-dashboard-panel"><EmptyState title="Unable to load analytics." description={query.error.message} /></Card>
      ) : null}

      <div className="dean-kpi-grid dean-insights-kpis">
        {cards.map(([label, value, Icon]) => (
          <Card className="dean-kpi-card" key={label}>
            <div>
              <span>{label}</span>
              <strong>{loading ? <SkeletonValue /> : value ?? "-"}</strong>
            </div>
            <Icon aria-hidden="true" />
          </Card>
        ))}
      </div>

      <Card className="dean-dashboard-panel">
        <div className="dean-dashboard-section-header">
          <div>
            <h2>Trends by period</h2>
            <p>Average score and pass rate (bars, %) with alerts per 100 attempts (line), using each student&apos;s latest submitted attempt.</p>
          </div>
        </div>
        <div className="chart-box dean-chart-box">
          {loading ? <SkeletonBlock className="skeleton-chart" /> : chartData.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                <XAxis dataKey="period" axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} tick={{ fill: chartTheme.axis, fontSize: 12 }} />
                <YAxis yAxisId="percent" domain={[0, 100]} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} tick={{ fill: chartTheme.axis }} />
                <YAxis yAxisId="alerts" orientation="right" allowDecimals={false} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} tick={{ fill: chartTheme.axis }} />
                <Tooltip cursor={{ fill: chartTheme.cursor }} contentStyle={{ background: chartTheme.tooltipBackground, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 14, color: chartTheme.tooltipText }} itemStyle={{ color: chartTheme.tooltipText }} labelStyle={{ color: chartTheme.tooltipText }} />
                <Legend wrapperStyle={{ color: chartTheme.axis, fontSize: 12 }} />
                <Bar yAxisId="percent" dataKey="Average score" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                <Bar yAxisId="percent" dataKey="Pass rate" fill="#06b6d4" radius={[6, 6, 0, 0]} />
                <Line yAxisId="alerts" dataKey="Alerts per 100 attempts" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No graded exams yet." description="Trends appear once published exams have submitted attempts." />}
        </div>
      </Card>

      <Card className="dean-dashboard-panel">
        <div className="dean-dashboard-section-header">
          <div>
            <h2>Section comparison</h2>
            <p>Highlighted: pass rate at least 10 points below overall, or high-risk share more than twice the overall share.</p>
          </div>
          <SelectField label="Sort" value={sort} onChange={(event) => setSort(event.target.value)}>
            {SORTS.map((item) => <option key={item}>{item}</option>)}
          </SelectField>
        </div>
        {loading ? <ListSkeleton columns={7} label="Loading sections..." variant="table" /> : (
          <Table
            className="dean-insights-table"
            columns={columns}
            emptyDescription="Sections appear once their published exams have submitted attempts."
            emptyTitle="No sections to compare."
            rows={sections}
          />
        )}
      </Card>

      <Card className="dean-dashboard-panel">
        <div className="dean-dashboard-section-header">
          <div>
            <h2>Recommendations</h2>
            <p>Suggested follow-ups based on the rules above. Review each before acting.</p>
          </div>
        </div>
        {loading ? <SkeletonBlock className="skeleton-chart" /> : analysis?.recommendations.length ? (
          <ul className="dean-insights-recommendations">
            {analysis.recommendations.map((item) => (
              <li key={item.title}>
                <span>{item.tag}</span>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No issues found." description="Sections and periods are within the expected range." />}
      </Card>
    </section>
  );
}
