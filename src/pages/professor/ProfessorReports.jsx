import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
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
} from "../../lib/professorReports";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";

const PAGE_SIZE = 10;
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

export default function ProfessorReports() {
  const { user } = useAuth();
  const [reportType, setReportType] = useState(REPORT_TYPES[0].id);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  // Keyed by user: the query cache is kept in the browser, so one account must never see another's reports.
  const query = useQuery({ queryKey: ["professor-reports", user?.id], enabled: hasSupabaseConfig && Boolean(user?.id), queryFn: () => loadReportData(user.id) });
  const loading = hasSupabaseConfig && query.isLoading;
  const context = useMemo(() => query.data ? buildReportContext(query.data) : null, [query.data]);
  const options = useMemo(() => context ? filterOptions(context, filters) : null, [context, filters]);
  const report = useMemo(() => context ? buildReport(context, reportType, filters) : null, [context, reportType, filters]);
  const pageData = getListPageSlice(report?.rows || [], page, PAGE_SIZE);
  const typeInfo = REPORT_TYPES.find((item) => item.id === reportType);
  const filterSummary = context ? describeFilters(reportType, filters, context) : [];

  // A grade sheet needs one course, so the first course is chosen once, when the data first arrives.
  const firstCourse = options?.courseCodes[0];
  const autoPicked = useRef(false);
  useEffect(() => {
    if (!firstCourse || autoPicked.current) return;
    autoPicked.current = true;
    setFilters((current) => (current.course === ALL ? { ...current, course: firstCourse } : current));
  }, [firstCourse]);

  useEffect(() => setPage(1), [filters, reportType]);

  function update(changes) {
    setFilters((current) => ({ ...current, ...changes }));
  }
  // Filters above the exam and student lists narrow them, so a chosen exam or student that no longer fits is cleared.
  function updateScope(changes) {
    update({ ...changes, examId: "", studentId: "" });
  }
  function resetFilters() {
    setFilters({ ...EMPTY_FILTERS, course: firstCourse || ALL });
  }

  const columns = (report?.columns || []).map((column) => ({ ...column, className: column.align === "center" ? "is-center" : undefined, render: (row) => cellContent(column, row) }));
  const layout = printLayout(report?.columns || []);
  const examChoices = options?.exams || [];
  const generatedAt = new Date().toLocaleString();
  const canExport = Boolean(report && !report.needs && report.rows.length);

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
                <option value="">{reportType === "integrity" ? "All exams" : "Choose an exam"}</option>
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
            {reportType === "student" ? (
              <SelectField label="Student" value={filters.studentId} onChange={(event) => update({ studentId: event.target.value })}>
                <option value="">Choose a student</option>
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
              <p>{report && !report.needs ? `${report.rows.length.toLocaleString()} rows. The screen shows ${PAGE_SIZE} at a time; printing and the CSV include every row.` : "Choose the filters for this report."}</p>
            </div>
          </div>
          {loading ? (
            <ListSkeleton columns={6} label="Loading reports..." variant="table" />
          ) : report?.needs ? (
            <EmptyState title={report.needs} description="Use the filters above." />
          ) : report ? (
            <>
              <Table className="professor-report-table" columns={columns} emptyDescription="Change the filters or the date range." emptyTitle="No rows match these filters." rows={pageData.rows} />
              <ListPagination count={report.rows.length} page={pageData.page} pageSize={PAGE_SIZE} onPage={setPage} />
            </>
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
              <div><dt>Rows</dt><dd>{report.rows.length.toLocaleString()}</dd></div>
              {filterSummary.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
            <ul>
              {report.summary.map((item) => <li key={item.label}><span>{item.label}</span><strong>{item.value}</strong></li>)}
            </ul>
          </header>
          <style>{`@page { size: ${layout.landscape ? "landscape" : "portrait"}; margin: 12mm 10mm 14mm; }`}</style>
          <table>
            <colgroup>{layout.widths.map((width, index) => <col key={report.columns[index].key} style={{ width }} />)}</colgroup>
            <thead><tr>{report.columns.map((column) => <th className={column.align === "center" ? "is-center" : undefined} key={column.key}>{column.label}</th>)}</tr></thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.id}>{report.columns.map((column) => <td className={column.align === "center" ? "is-center" : undefined} key={column.key}>{formatCell(column, row[column.key])}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <footer>
            <div><span /><p>Prepared by: {user?.fullName || user?.email}</p></div>
            <div><span /><p>Date</p></div>
          </footer>
        </div>
      ) : null}
    </section>
  );
}
