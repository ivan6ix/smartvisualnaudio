import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { FiBookOpen, FiCheckSquare, FiDownload, FiGrid, FiPrinter, FiShield, FiUser, FiX } from "react-icons/fi";
import { ListPagination } from "../../components/ListViewControls";
import { Badge, Button, Card, EmptyState, ListSkeleton, SearchBox, SelectField, SkeletonValue, Table } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { fetchAllRows } from "../../lib/fetchAllRows";
import { getListPageSlice } from "../../lib/listView";
import {
  ALL,
  DATE_RANGES,
  EMPTY_FILTERS,
  PERIODS,
  REPORT_TYPES,
  SEVERITIES,
  STATUSES,
  buildReport,
  buildReportContext,
  courseLabel,
  describeFilters,
  examTitle,
  filterOptions,
  formatCell,
  printLayout,
  reportCsv,
  reportFileName,
  reportRowCount,
} from "../../lib/professorReports";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

const PAGE_SIZE = 10;
const GROUPS_PER_PAGE = 5;
const GROUP_NOUNS = { "grade-sheet": "course", "exam-results": "exam", student: "student" };
const REPORT_ICONS = { table: FiGrid, check: FiCheckSquare, shield: FiShield, user: FiUser, book: FiBookOpen };
const MISSING_TABLE_CODES = ["42P01", "PGRST205"];
const TONES = {
  Passed: "success",
  Submitted: "success",
  Low: "success",
  Failed: "danger",
  Missing: "danger",
  High: "danger",
  Incomplete: "warn",
  "Needs grading": "warn",
  "In progress": "warn",
  Reopened: "warn",
  Medium: "warn",
};
const BADGE_KEYS = new Set(["remark", "status", "risk", "severity"]);

function throwIfError(response, { optional = false } = {}) {
  if (response.error && !(optional && MISSING_TABLE_CODES.includes(response.error.code))) throw response.error;
  return response.data || [];
}

// Two rounds, like Scores: the professor's courses and published exams, then everything for those exams. Every
// table is read in full (the API returns at most 1000 rows per request) and filtered by course or exam.
async function loadReportData(userId) {
  const [coursesResponse, examsResponse] = await Promise.all([
    supabase.from("courses").select("id, course_name, course_code, section").eq("professor_id", userId).eq("archived", false).order("course_code"),
    supabase
      .from("exams")
      .select("id, title, exam_title, course_id, description, exam_type, status, exam_settings, assignment_mode, passing_score, duration, time_limit, created_at")
      .or(`professor_id.eq.${userId},created_by.eq.${userId}`)
      .eq("status", "Published")
      .order("created_at"),
  ]);
  const courses = throwIfError(coursesResponse);
  const courseIds = courses.map((course) => course.id);
  const courseIdSet = new Set(courseIds);
  const exams = throwIfError(examsResponse).filter((exam) => courseIdSet.has(exam.course_id));
  const examIds = exams.map((exam) => exam.id);
  const profile = "profiles:student_id(id, full_name, student_number, email)";
  const none = Promise.resolve({ data: [], error: null });

  const [enrollments, assignments, exceptions, attempts, starts, violations, pendingAnswers] = await Promise.all([
    courseIds.length ? fetchAllRows((options) => supabase.from("course_enrollments").select(`course_id, student_id, ${profile}`, options).in("course_id", courseIds).order("course_id").order("student_id")) : none,
    examIds.length ? fetchAllRows((options) => supabase.from("exam_student_assignments").select(`exam_id, student_id, ${profile}`, options).in("exam_id", examIds).order("exam_id").order("student_id")) : none,
    examIds.length ? fetchAllRows((options) => supabase.from("exam_student_access_exceptions").select(`exam_id, student_id, ${profile}`, options).in("exam_id", examIds).order("exam_id").order("student_id")) : none,
    examIds.length ? fetchAllRows((options) => supabase.from("exam_attempts").select(`id, exam_id, student_id, score, earned_points, max_points, status, started_at, submitted_at, ${profile}`, options).in("exam_id", examIds).order("id")) : none,
    examIds.length ? fetchAllRows((options) => supabase.from("exam_start_sessions").select("exam_id, student_id", options).in("exam_id", examIds).order("exam_id").order("student_id")) : none,
    examIds.length ? fetchAllRows((options) => supabase.from("violations").select("id, exam_id, student_id, violation_type, severity, created_at", options).in("exam_id", examIds).order("id")) : none,
    // Only answers still waiting for manual grading; the inner join filters them by their attempt's exam.
    examIds.length ? fetchAllRows((options) => supabase.from("exam_attempt_answers").select("id, attempt_id, exam_attempts!inner(exam_id)", options).eq("needs_manual_grading", true).in("exam_attempts.exam_id", examIds).order("id")) : none,
  ]);

  const rows = {
    enrollments: throwIfError(enrollments),
    assignments: throwIfError(assignments, { optional: true }),
    exceptions: throwIfError(exceptions, { optional: true }),
    attempts: throwIfError(attempts),
    starts: throwIfError(starts),
    violations: throwIfError(violations),
    pendingAnswers: throwIfError(pendingAnswers),
  };
  const students = new Map();
  for (const row of [...rows.enrollments, ...rows.assignments, ...rows.exceptions, ...rows.attempts]) {
    if (row.profiles?.id && !students.has(row.profiles.id)) students.set(row.profiles.id, row.profiles);
  }
  const strip = (list) => list.map(({ profiles: _profile, ...row }) => row);
  return {
    courses,
    exams,
    enrollments: strip(rows.enrollments),
    assignments: strip(rows.assignments),
    exceptions: strip(rows.exceptions),
    attempts: strip(rows.attempts),
    starts: rows.starts,
    violations: rows.violations,
    pendingAttemptIds: [...new Set(rows.pendingAnswers.map((answer) => answer.attempt_id))],
    students: [...students.values()],
  };
}

function downloadCsv(text, fileName) {
  const url = window.URL.createObjectURL(new window.Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.URL.revokeObjectURL(url);
}

function cellContent(column, row) {
  const text = formatCell(column, row[column.key]);
  return BADGE_KEYS.has(column.key) && TONES[text] ? <Badge tone={TONES[text]}>{text}</Badge> : text;
}

const centered = (column) => (column.align === "center" ? "is-center" : undefined);

// One table on screen, 10 rows at a time.
function ScreenTable({ table }) {
  const [page, setPage] = useState(1);
  const columns = table.columns.map((column) => ({ ...column, className: centered(column), render: (row) => cellContent(column, row) }));
  const pageData = getListPageSlice(table.rows, page, PAGE_SIZE);
  return (
    <>
      <Table className="professor-report-table" columns={columns} emptyDescription="Change the filters or the date range." emptyTitle="No rows match these filters." rows={pageData.rows} />
      <ListPagination count={table.rows.length} page={pageData.page} pageSize={PAGE_SIZE} onPage={setPage} />
    </>
  );
}

// One table on paper: every row, columns sized to fit the page.
function PrintTable({ table }) {
  const { widths } = printLayout(table.columns);
  return (
    <table>
      <colgroup>{widths.map((width, index) => <col key={table.columns[index].key} style={{ width }} />)}</colgroup>
      <thead><tr>{table.columns.map((column) => <th className={centered(column)} key={column.key}>{column.label}</th>)}</tr></thead>
      <tbody>
        {table.rows.map((row) => (
          <tr key={row.id}>{table.columns.map((column) => <td className={centered(column)} key={column.key}>{formatCell(column, row[column.key])}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ProfessorReports() {
  const { user } = useAuth();
  const [reportType, setReportType] = useState(REPORT_TYPES[0].id);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [groupPage, setGroupPage] = useState(1);
  // Keyed by user: the query cache is kept in the browser, so one account must never see another's reports.
  const query = useQuery({ queryKey: ["professor-reports", user?.id], enabled: hasSupabaseConfig && Boolean(user?.id), queryFn: () => loadReportData(user.id) });
  const loading = hasSupabaseConfig && query.isLoading;
  const context = useMemo(() => query.data ? buildReportContext(query.data) : null, [query.data]);
  const options = useMemo(() => context ? filterOptions(context, filters) : null, [context, filters]);
  const report = useMemo(() => context ? buildReport(context, reportType, filters) : null, [context, reportType, filters]);
  const typeInfo = REPORT_TYPES.find((item) => item.id === reportType);
  const filterSummary = context ? describeFilters(reportType, filters, context) : [];
  // With All chosen, a report is several titled tables (one per course, exam or student); otherwise one table.
  const tables = report ? report.groups || [{ id: "report", title: "", subtitle: "", columns: report.columns, rows: report.rows }] : [];
  const groupSlice = getListPageSlice(tables, groupPage, GROUPS_PER_PAGE);
  const rowCount = report ? reportRowCount(report) : 0;
  const landscape = tables.some((table) => printLayout(table.columns).landscape);
  // A new report or filter shows the first page; the key also resets each table's own row pages.
  const resetKey = `${reportType}|${JSON.stringify(filters)}`;

  useEffect(() => setGroupPage(1), [resetKey]);

  function update(changes) {
    setFilters((current) => ({ ...current, ...changes }));
  }
  // Filters above the exam and student lists narrow them, so a chosen exam or student that no longer fits is cleared.
  function updateScope(changes) {
    update({ ...changes, examId: "", studentId: "" });
  }
  function resetFilters() {
    setFilters(EMPTY_FILTERS);
  }

  const examChoices = options?.exams || [];
  const generatedAt = new Date().toLocaleString();
  const canExport = rowCount > 0;
  const groupNoun = GROUP_NOUNS[reportType] || "table";

  return (
    <section className="dean-dashboard-page professor-reports-page">
      <div className="professor-report-screen">
        <header className="dean-dashboard-header professor-reports-header">
          <div>
            <h1>Reports</h1>
            <p>Generate, print and download reports for your courses.</p>
          </div>
          <div className="professor-reports-actions">
            <Button disabled={!canExport} onClick={() => downloadCsv(reportCsv(report), reportFileName(reportType))} variant="light"><FiDownload /> Download CSV</Button>
            <Button disabled={!canExport} onClick={() => window.print()}><FiPrinter /> Print / Save as PDF</Button>
          </div>
        </header>

        <div className="professor-report-types" role="tablist" aria-label="Report type">
          {REPORT_TYPES.map((item) => {
            const Icon = REPORT_ICONS[item.icon];
            return (
              <button aria-selected={reportType === item.id} className={reportType === item.id ? "active" : ""} key={item.id} onClick={() => setReportType(item.id)} role="tab" type="button">
                <Icon aria-hidden="true" />
                <strong>{item.label}</strong>
                <span>{item.hint}</span>
              </button>
            );
          })}
        </div>

        <Card className="dean-dashboard-panel dean-dashboard-controls">
          <div className="dean-dashboard-search-row">
            <SearchBox value={filters.search} onChange={(value) => update({ search: value })} placeholder={reportType === "course-summary" ? "Search courses..." : "Search student name or number..."} />
            {filters.search ? <Button variant="light" onClick={() => update({ search: "" })}><FiX /> Clear</Button> : null}
          </div>
          <div className="dean-dashboard-filters professor-report-filters">
            <SelectField label="Course" value={filters.course} onChange={(event) => updateScope({ course: event.target.value, section: ALL })}>
              <option value={ALL}>All courses</option>
              {(options?.courseCodes || []).map((code) => <option key={code}>{code}</option>)}
            </SelectField>
            <SelectField label="Section" value={filters.section} onChange={(event) => updateScope({ section: event.target.value })}>
              <option value={ALL}>All sections</option>
              {(options?.sections || []).map((section) => <option key={section}>{section}</option>)}
            </SelectField>
            <SelectField label="Period" value={filters.period} onChange={(event) => updateScope({ period: event.target.value })}>
              <option value={ALL}>All periods</option>
              {PERIODS.map((period) => <option key={period}>{period}</option>)}
            </SelectField>
            <SelectField label="Type" value={filters.type} onChange={(event) => updateScope({ type: event.target.value })}>
              <option value={ALL}>Exams and quizzes</option>
              {(options?.types || []).map((type) => <option key={type}>{type}</option>)}
            </SelectField>
            <SelectField label={reportType === "integrity" ? "Alert dates" : "Exam dates"} value={filters.dateRange} onChange={(event) => updateScope({ dateRange: event.target.value })}>
              {DATE_RANGES.map((range) => <option key={range}>{range}</option>)}
            </SelectField>
            {filters.dateRange === "Custom range" ? (
              <>
                <label className="field"><span>From</span><input max={filters.to || undefined} onChange={(event) => updateScope({ from: event.target.value })} type="date" value={filters.from} /></label>
                <label className="field"><span>To</span><input min={filters.from || undefined} onChange={(event) => updateScope({ to: event.target.value })} type="date" value={filters.to} /></label>
              </>
            ) : null}
            {reportType === "exam-results" || reportType === "integrity" ? (
              <SelectField label="Exam" value={filters.examId} onChange={(event) => update({ examId: event.target.value })}>
                <option value="">All exams</option>
                {examChoices.map((exam) => <option key={exam.id} value={exam.id}>{`${examTitle(exam)} (${courseLabel(context.courseById.get(exam.course_id))})`}</option>)}
              </SelectField>
            ) : null}
            {reportType === "exam-results" ? (
              <SelectField label="Status" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
                <option value={ALL}>All statuses</option>
                {STATUSES.map((status) => <option key={status}>{status}</option>)}
              </SelectField>
            ) : null}
            {reportType === "integrity" ? (
              <>
                <SelectField label="Alert type" value={filters.alertType} onChange={(event) => update({ alertType: event.target.value })}>
                  <option value={ALL}>All alerts</option>
                  {(options?.alertTypes || []).map((type) => <option key={type}>{type}</option>)}
                </SelectField>
                <SelectField label="Severity" value={filters.severity} onChange={(event) => update({ severity: event.target.value })}>
                  <option value={ALL}>All severities</option>
                  {SEVERITIES.map((severity) => <option key={severity}>{severity}</option>)}
                </SelectField>
              </>
            ) : null}
            {reportType === "student" || reportType === "integrity" ? (
              <SelectField label="Student" value={filters.studentId} onChange={(event) => update({ studentId: event.target.value })}>
                <option value="">All students</option>
                {(options?.students || []).map((student) => <option key={student.id} value={student.id}>{`${student.full_name || student.email || "Unknown student"}${student.student_number ? ` (${student.student_number})` : ""}`}</option>)}
              </SelectField>
            ) : null}
            <Button variant="light" onClick={resetFilters}>Reset Filters</Button>
          </div>
        </Card>

        {query.error ? <Card className="dean-dashboard-panel"><EmptyState title="Unable to load report data." description={query.error.message} /></Card> : null}

        {report?.summary.length || loading ? (
          <div className="dean-kpi-grid professor-report-kpis">
            {(loading ? [{ label: "Loading" }, { label: "Loading" }, { label: "Loading" }, { label: "Loading" }] : report.summary).map((item, index) => (
              <Card className="dean-kpi-card" key={`${item.label}-${index}`}>
                <div>
                  <span>{loading ? "" : item.label}</span>
                  <strong>{loading ? <SkeletonValue /> : item.value}</strong>
                </div>
              </Card>
            ))}
          </div>
        ) : null}

        <Card className="dean-dashboard-panel">
          <div className="dean-dashboard-section-header">
            <div>
              <h2>{typeInfo.label}{report?.title ? `: ${report.title}` : ""}</h2>
              <p>
                {report?.groups
                  ? `${tables.length.toLocaleString()} ${groupNoun}${tables.length === 1 ? "" : "s"}, ${rowCount.toLocaleString()} rows. The screen shows ${GROUPS_PER_PAGE} ${groupNoun}s and ${PAGE_SIZE} rows at a time; printing and the CSV include everything.`
                  : `${rowCount.toLocaleString()} rows. The screen shows ${PAGE_SIZE} at a time; printing and the CSV include every row.`}
              </p>
            </div>
          </div>
          {loading ? (
            <ListSkeleton columns={6} label="Loading reports..." variant="table" />
          ) : report?.groups ? (
            tables.length ? (
              <>
                {groupSlice.rows.map((group) => (
                  <section className="professor-report-group" key={group.id}>
                    <h3>{group.title}</h3>
                    <p>{group.subtitle}</p>
                    <ScreenTable key={`${resetKey}|${group.id}`} table={group} />
                  </section>
                ))}
                <ListPagination count={tables.length} page={groupSlice.page} pageSize={GROUPS_PER_PAGE} onPage={setGroupPage} />
              </>
            ) : (
              <EmptyState title="No rows match these filters." description="Change the filters or the date range." />
            )
          ) : report ? (
            <ScreenTable key={resetKey} table={tables[0]} />
          ) : null}
        </Card>
      </div>

      {canExport ? (
        <div className="professor-report-print" aria-hidden="true">
          <header>
            <p>Smart Proctoring System</p>
            <h1>{typeInfo.label} report</h1>
            {report.title ? <h2>{report.title}</h2> : null}
            <dl>
              <div><dt>Professor</dt><dd>{user?.fullName || user?.email}</dd></div>
              <div><dt>Generated</dt><dd>{generatedAt}</dd></div>
              <div><dt>Rows</dt><dd>{rowCount.toLocaleString()}</dd></div>
              {filterSummary.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
            <ul>
              {report.summary.map((item) => <li key={item.label}><span>{item.label}</span><strong>{item.value}</strong></li>)}
            </ul>
          </header>
          <style>{`@page { size: ${landscape ? "landscape" : "portrait"}; margin: 12mm 10mm 14mm; }`}</style>
          {tables.map((table, index) => (
            <section className={`professor-report-print-group${table.pageBreak && index ? " page-break" : ""}`} key={table.id}>
              {report.groups ? (
                <>
                  <h3>{table.title}</h3>
                  <p>{table.subtitle}</p>
                </>
              ) : null}
              <PrintTable table={table} />
            </section>
          ))}
          <footer>
            <div><span /><p>Prepared by: {user?.fullName || user?.email}</p></div>
            <div><span /><p>Date</p></div>
          </footer>
        </div>
      ) : null}
    </section>
  );
}
