import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FiAlertTriangle, FiBarChart2, FiCheckCircle, FiFileText, FiTrendingDown, FiUsers, FiX } from "react-icons/fi";
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ListPagination } from "../../components/ListViewControls";
import { Badge, Button, Card, EmptyState, ListSkeleton, SearchBox, SelectField, SkeletonBlock, SkeletonValue, Table } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useChartTheme } from "../../context/ThemeContext";
import { buildDeanAnalytics } from "../../lib/deanAnalytics";
import { fetchAllRows } from "../../lib/fetchAllRows";
import { getListPageSlice } from "../../lib/listView";
import { FALLING_SLOPE } from "../../lib/riskPrediction";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

const ALL = "All";
const SORTS = ["Section", "Lowest pass rate", "Lowest average", "Highest risk"];
const AT_RISK_PAGE_SIZE = 5;
const FALLING = "Falling scores only";

function percent(value, digits = 0) {
  return value === null || value === undefined ? "-" : `${(value * 100).toFixed(digits)}%`;
}

// The backtest's four outcomes. Right calls are blue and teal, wrong ones amber and rose (checked for color blindness
// in both themes); every slice is also named with its count in the legend.
const BACKTEST_OUTCOMES = [
  { key: "tp", label: "Predicted to fail, and failed", color: "#3b82f6" },
  { key: "tn", label: "Predicted to pass, and passed", color: "#0d9488" },
  { key: "fp", label: "Predicted to fail, but passed", color: "#d97706" },
  { key: "fn", label: "Failed, but not predicted", color: "#e11d48" },
];

function backtestSlices(result) {
  return BACKTEST_OUTCOMES.map((outcome) => ({ ...outcome, value: Number(result?.[outcome.key] || 0) }));
}

function score(value) {
  return value === null || value === undefined ? "-" : `${value.toFixed(1)}%`;
}

// Every table is read in full: the API returns at most 1000 rows per request.
async function loadAnalyticsData() {
  const [coursesResponse, programsResponse, examsResponse, attemptsResponse, violationsResponse, studentsResponse] = await Promise.all([
    fetchAllRows((options) => supabase.from("courses").select("id, course_code, section, course_name, semester, academic_year, program_id", options).order("id")),
    fetchAllRows((options) => supabase.from("programs").select("id, program_code, program_name", options).order("id")),
    fetchAllRows((options) => supabase.from("exams").select("id, title, course_id, status, description, passing_score", options).eq("status", "Published").order("id")),
    fetchAllRows((options) => supabase.from("exam_attempts").select("id, exam_id, student_id, score, status, started_at, submitted_at", options).order("id")),
    fetchAllRows((options) => supabase.from("violations").select("exam_id, student_id, violation_type, created_at", options).order("id")),
    fetchAllRows((options) => supabase.from("profiles").select("id, full_name, student_number, email", options).eq("role", "Student").order("id")),
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

// Wording per role. The data needs no role filter: row-level security already limits a professor to their own
// courses, exams, attempts and violations.
const SCOPE_TEXT = {
  dean: {
    subtitle: "Exam results and integrity across periods and sections, with recommendations for follow-up.",
    missedExams: "Missed exams are not counted, because exam assignments are visible only to professors.",
  },
  professor: {
    subtitle: "Exam results and integrity across your periods and sections, with recommendations for follow-up.",
    missedExams: "Missed exams are not counted.",
  },
};

export default function DeanAnalytics({ scope = "dean" }) {
  const chartTheme = useChartTheme();
  const { user } = useAuth();
  const text = SCOPE_TEXT[scope] || SCOPE_TEXT.dean;
  const [academicYear, setAcademicYear] = useState(ALL);
  const [semester, setSemester] = useState(ALL);
  const [programId, setProgramId] = useState(ALL);
  const [courseId, setCourseId] = useState(ALL);
  const [examId, setExamId] = useState(ALL);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(SORTS[0]);
  const [riskLevel, setRiskLevel] = useState(ALL);
  const [riskSection, setRiskSection] = useState(ALL);
  const [riskTrend, setRiskTrend] = useState(ALL);
  const [riskPage, setRiskPage] = useState(1);
  // Filters above the course list narrow it, so a chosen course or exam that no longer fits is cleared.
  const changeTermFilter = (setter) => (event) => {
    setter(event.target.value);
    setCourseId(ALL);
    setExamId(ALL);
    setRiskPage(1);
  };
  const resetFilters = () => {
    [setAcademicYear, setSemester, setProgramId, setCourseId, setExamId, setRiskLevel, setRiskSection, setRiskTrend].forEach((setter) => setter(ALL));
    setSearch("");
    setRiskPage(1);
  };
  // Keyed by role and user: the query cache is kept in the browser, so one account must never see another's results.
  const query = useQuery({ queryKey: [`${scope}-analytics`, user?.id], enabled: hasSupabaseConfig && Boolean(user?.id), queryFn: loadAnalyticsData });
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
      courseId: courseId === ALL ? "" : courseId,
      examId: examId === ALL ? "" : examId,
    },
  }) : null, [academicYear, courseId, data, examId, programId, semester]);
  const term = search.trim().toLowerCase();

  const programName = useMemo(() => new Map((data?.programs || []).map((program) => [program.id, program.program_code || program.program_name])), [data?.programs]);
  const sections = useMemo(() => {
    const rows = (analysis?.sections || []).filter((row) => !term || `${row.label} ${row.courseName}`.toLowerCase().includes(term));
    if (sort === "Lowest pass rate") rows.sort((left, right) => (left.passRate ?? 2) - (right.passRate ?? 2));
    if (sort === "Lowest average") rows.sort((left, right) => (left.averageScore ?? 1000) - (right.averageScore ?? 1000));
    if (sort === "Highest risk") rows.sort((left, right) => (right.highRiskRate ?? -1) - (left.highRiskRate ?? -1));
    return rows;
  }, [analysis?.sections, sort, term]);
  const chartData = (analysis?.periods || []).map((row) => ({
    period: row.period,
    "Average score": row.averageScore === null ? null : Number(row.averageScore.toFixed(1)),
    "Pass rate": row.passRate === null ? null : Math.round(row.passRate * 100),
    "Alerts per 100 attempts": row.alertsPer100 === null ? null : Math.round(row.alertsPer100),
  }));
  const kpis = analysis?.kpis;
  const studentById = useMemo(() => new Map((data?.students || []).map((student) => [student.id, student])), [data?.students]);
  const allAtRiskRows = (analysis?.atRisk || []).map((row) => {
    const student = studentById.get(row.studentId);
    return {
      ...row,
      id: `${row.studentId}:${row.courseId}`,
      studentName: student?.full_name || student?.email || "Unknown student",
      studentNumber: student?.student_number || "",
    };
  });
  const atRiskSections = [...new Set(allAtRiskRows.map((row) => row.sectionLabel))].sort();
  const atRiskRows = allAtRiskRows.filter((row) => (riskLevel === ALL || row.level === riskLevel)
    && (riskSection === ALL || row.sectionLabel === riskSection)
    && (riskTrend === ALL || row.slope <= FALLING_SLOPE)
    && (!term || `${row.studentName} ${row.studentNumber} ${row.sectionLabel}`.toLowerCase().includes(term)));
  const atRiskPage = getListPageSlice(atRiskRows, riskPage, AT_RISK_PAGE_SIZE);
  const changeRiskFilter = (setter) => (event) => {
    setter(event.target.value);
    setRiskPage(1);
  };
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
        <p>{text.subtitle}</p>
      </header>

      <Card className="dean-dashboard-panel dean-dashboard-controls">
        <div className="dean-dashboard-search-row">
          <SearchBox value={search} onChange={(value) => { setSearch(value); setRiskPage(1); }} placeholder="Search sections, courses, or students..." />
          {search ? <Button variant="light" onClick={() => { setSearch(""); setRiskPage(1); }}><FiX /> Clear</Button> : null}
        </div>
        <div className="dean-dashboard-filters">
          <SelectField label="Academic Year" value={academicYear} onChange={changeTermFilter(setAcademicYear)}>
            <option>{ALL}</option>
            {(analysis?.options.academicYears || []).map((item) => <option key={item}>{item}</option>)}
          </SelectField>
          <SelectField label="Semester" value={semester} onChange={changeTermFilter(setSemester)}>
            <option>{ALL}</option>
            {(analysis?.options.semesters || []).map((item) => <option key={item}>{item}</option>)}
          </SelectField>
          <SelectField label="Program" value={programId} onChange={changeTermFilter(setProgramId)}>
            <option value={ALL}>{ALL}</option>
            {(analysis?.options.programIds || []).map((id) => <option key={id} value={id}>{programName.get(id) || "Unnamed program"}</option>)}
          </SelectField>
          <SelectField label="Course" value={courseId} onChange={(event) => { setCourseId(event.target.value); setExamId(ALL); setRiskPage(1); }}>
            <option value={ALL}>All Courses</option>
            {(analysis?.options.courses || []).map((course) => <option key={course.id} value={course.id}>{course.label}</option>)}
          </SelectField>
          <SelectField label="Exam" value={examId} onChange={(event) => setExamId(event.target.value)}>
            <option value={ALL}>All Exams</option>
            {(analysis?.options.exams || []).map((exam) => <option key={exam.id} value={exam.id}>{exam.label}</option>)}
          </SelectField>
          <Button variant="light" onClick={resetFilters}>Reset Filters</Button>
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
            emptyDescription={term ? "Search matches section codes and course names; students are listed under Students at risk." : "Sections appear once their published exams have submitted attempts."}
            emptyTitle={term ? "No sections match the search." : "No sections to compare."}
            rows={sections}
          />
        )}
      </Card>

      <div className="dean-insights-row">
        <Card className="dean-dashboard-panel dean-insights-wide">
          <div className="dean-dashboard-section-header">
            <div>
              <h2>Students at risk of failing the next exam</h2>
              <p>Predicted from each student&apos;s scores in the section: the average of their last 3 scores plus a quarter of their score trend (the weight that predicted best in the accuracy test). {text.missedExams} The prediction uses every exam in the section, so the Exam filter does not change this list.</p>
            </div>
            <span>{loading ? <SkeletonValue /> : `${atRiskRows.length} student${atRiskRows.length === 1 ? "" : "s"}`}</span>
          </div>
          <div className="dean-dashboard-filters dean-insights-risk-filters">
            <SelectField label="Risk" value={riskLevel} onChange={changeRiskFilter(setRiskLevel)}>
              <option value={ALL}>All Risk Levels</option>
              <option>High</option>
              <option>Medium</option>
            </SelectField>
            <SelectField label="Section" value={riskSection} onChange={changeRiskFilter(setRiskSection)}>
              <option value={ALL}>All Sections</option>
              {atRiskSections.map((label) => <option key={label}>{label}</option>)}
            </SelectField>
            <SelectField label="Score Trend" value={riskTrend} onChange={changeRiskFilter(setRiskTrend)}>
              <option value={ALL}>All Trends</option>
              <option>{FALLING}</option>
            </SelectField>
          </div>
          {loading ? <ListSkeleton columns={6} label="Loading predictions..." variant="table" /> : (
            <>
              <Table
                className="dean-insights-table"
                columns={atRiskColumns}
                emptyDescription={allAtRiskRows.length ? "Adjust the search or filters to show more students." : "No student's recent scores predict a failing or borderline result."}
                emptyTitle={allAtRiskRows.length ? "No students match the filters." : "No students at risk."}
                rows={atRiskPage.rows}
              />
              <ListPagination count={atRiskRows.length} page={atRiskPage.page} pageSize={AT_RISK_PAGE_SIZE} onPage={setRiskPage} />
            </>
          )}
        </Card>

        <div className="dean-insights-side">
        <Card className="dean-dashboard-panel dean-insights-accuracy">
          <div className="dean-dashboard-section-header">
            <div>
              <h2>How accurate is this?</h2>
              <p>We hid each student&apos;s latest exam, predicted it from their earlier exams, and compared with what actually happened.</p>
            </div>
          </div>
          {loading ? <SkeletonBlock className="skeleton-chart" /> : backtestResult?.evaluated ? (
            <div className="dean-insights-pie">
              <div className="dean-insights-pie-chart">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={backtestSlices(backtestResult).filter((slice) => slice.value > 0)}
                      dataKey="value"
                      nameKey="label"
                      innerRadius="62%"
                      outerRadius="92%"
                      startAngle={90}
                      endAngle={-270}
                      stroke="var(--app-surface)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {backtestSlices(backtestResult).filter((slice) => slice.value > 0).map((slice) => <Cell key={slice.key} fill={slice.color} />)}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [`${value} of ${backtestResult.evaluated} students`, name]}
                      contentStyle={{ background: chartTheme.tooltipBackground, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 14, color: chartTheme.tooltipText }}
                      itemStyle={{ color: chartTheme.tooltipText }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dean-insights-pie-center" aria-hidden="true">
                  <strong>{percent(backtestResult.accuracy)}</strong>
                  <span>accurate</span>
                </div>
              </div>
              <ul className="dean-insights-pie-legend" aria-label={`Accuracy ${percent(backtestResult.accuracy)} across ${backtestResult.evaluated} tested students`}>
                {backtestSlices(backtestResult).map((slice) => (
                  <li key={slice.key}>
                    <i style={{ background: slice.color }} />
                    <span>{slice.label}</span>
                    <strong>{slice.value}</strong>
                  </li>
                ))}
              </ul>
              <div className="dean-insights-pie-stats">
                <span>Tested <strong>{backtestResult.evaluated}</strong></span>
                <span>Precision <strong>{percent(backtestResult.precision)}</strong></span>
                <span>Recall <strong>{percent(backtestResult.recall)}</strong></span>
              </div>
            </div>
          ) : <EmptyState title="Not enough history yet." description="Needs students with at least 3 graded exams in the same section." />}
        </Card>

        {/* Recommendations fill the rest of the column beside the students table and scroll inside it. */}
        <Card className="dean-dashboard-panel dean-insights-recs">
          <div className="dean-dashboard-section-header">
            <div>
              <h2>Recommendations</h2>
              <p>Suggested follow-ups based on the rules above. Review each before acting.</p>
            </div>
          </div>
          <div className="dean-insights-recs-body">
            <div className="dean-insights-recs-scroll" tabIndex={0} aria-label="Recommendations">
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
            </div>
          </div>
        </Card>
        </div>
      </div>
    </section>
  );
}
