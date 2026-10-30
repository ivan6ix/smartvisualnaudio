import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FiAlertTriangle, FiBarChart2, FiCheckCircle, FiFileText, FiTrendingDown, FiUsers } from "react-icons/fi";
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
  const [coursesResponse, programsResponse, examsResponse, attemptsResponse, violationsResponse, studentsResponse] = await Promise.all([
    supabase.from("courses").select("id, course_code, section, course_name, semester, academic_year, program_id"),
    supabase.from("programs").select("id, program_code, program_name"),
    supabase.from("exams").select("id, course_id, status, description, passing_score").eq("status", "Published"),
    supabase.from("exam_attempts").select("id, exam_id, student_id, score, status, started_at, submitted_at").limit(20000),
    supabase.from("violations").select("exam_id, student_id, violation_type, created_at").limit(20000),
    supabase.from("profiles").select("id, full_name, student_number, email").eq("role", "Student").limit(10000),
  ]);
  for (const response of [coursesResponse, examsResponse, attemptsResponse, violationsResponse, studentsResponse]) {
    if (response.error) throw response.error;
  }
  return {
    courses: coursesResponse.data || [],
    students: studentsResponse.data || [],
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
  const studentById = useMemo(() => new Map((data?.students || []).map((student) => [student.id, student])), [data?.students]);
  const atRiskRows = (analysis?.atRisk || []).map((row) => {
    const student = studentById.get(row.studentId);
    return {
      ...row,
      id: `${row.studentId}:${row.courseId}`,
      studentName: student?.full_name || student?.email || "Unknown student",
      studentNumber: student?.student_number || "",
    };
  });
  const backtestResult = analysis?.backtest;
  const atRiskColumns = [
    { key: "studentName", label: "Student", render: (row) => <span className="dean-insights-section"><strong>{row.studentName}</strong><small>{row.studentNumber}</small></span> },
    { key: "sectionLabel", label: "Section" },
    { key: "scores", label: "Last scores", render: (row) => row.scores.slice(-3).map((value) => Math.round(value)).join(" → ") },
    { key: "predicted", label: "Predicted next", render: (row) => <strong>{Math.round(row.predicted)}%</strong> },
    { key: "reasons", label: "Why", render: (row) => <span className="dean-insights-reasons">{row.reasons.join(" · ")}</span> },
    { key: "level", label: "Risk", render: (row) => <Badge tone={row.level === "High" ? "danger" : "warn"}>{row.level}</Badge> },
  ];

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
    ["Students at risk", kpis?.studentsAtRisk, FiTrendingDown],
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

      <div className="dean-insights-row">
        <Card className="dean-dashboard-panel dean-insights-wide">
          <div className="dean-dashboard-section-header">
            <div>
              <h2>Students at risk of failing the next exam</h2>
              <p>Predicted from each student&apos;s scores in the section: the average of their last 3 scores plus a quarter of their score trend (the weight that predicted best in the accuracy test). Missed exams are not counted, because exam assignments are visible only to professors.</p>
            </div>
            <span>{loading ? <SkeletonValue /> : `${atRiskRows.length} student${atRiskRows.length === 1 ? "" : "s"}`}</span>
          </div>
          {loading ? <ListSkeleton columns={6} label="Loading predictions..." variant="table" /> : (
            <Table
              className="dean-insights-table"
              columns={atRiskColumns}
              emptyDescription="No student's recent scores predict a failing or borderline result."
              emptyTitle="No students at risk."
              rows={atRiskRows}
            />
          )}
        </Card>

        <Card className="dean-dashboard-panel dean-insights-accuracy">
          <div className="dean-dashboard-section-header">
            <div>
              <h2>How accurate is this?</h2>
              <p>We hid each student&apos;s latest exam, predicted it from their earlier exams, and compared with what actually happened.</p>
            </div>
          </div>
          {loading ? <SkeletonBlock className="skeleton-chart" /> : backtestResult?.evaluated ? (
            <>
              <div className="dean-insights-metrics">
                <div><span>Tested</span><strong>{backtestResult.evaluated}</strong></div>
                <div><span>Precision</span><strong>{percent(backtestResult.precision)}</strong></div>
                <div><span>Recall</span><strong>{percent(backtestResult.recall)}</strong></div>
                <div><span>Accuracy</span><strong>{percent(backtestResult.accuracy)}</strong></div>
              </div>
              <p className="dean-insights-note">
                Predicted to fail: {backtestResult.tp + backtestResult.fp}, of whom {backtestResult.tp} actually failed (precision).
                Actually failed: {backtestResult.tp + backtestResult.fn}, of whom {backtestResult.tp} were predicted (recall).
                Guessing that nobody fails would be {percent(backtestResult.baselineAccuracy)} accurate.
              </p>
            </>
          ) : <EmptyState title="Not enough history yet." description="Needs students with at least 3 graded exams in the same section." />}
        </Card>
      </div>

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
