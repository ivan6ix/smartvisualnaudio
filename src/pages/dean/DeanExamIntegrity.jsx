import { useEffect, useMemo, useRef, useState } from "react";
import { FiActivity, FiAlertTriangle, FiCamera, FiShield, FiX } from "react-icons/fi";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import WrappedAxisTick, { WRAPPED_AXIS_HEIGHT } from "../../components/charts/WrappedAxisTick";
import { toast } from "sonner";
import IntegrityReview from "../../components/exam/IntegrityReview";
import { ListPagination, ListViewToolbar, RecordCardList } from "../../components/ListViewControls";
import { Badge, Button, Card, EmptyState, ListSkeleton, SearchBox, SelectField, SkeletonBlock, SkeletonValue, Table } from "../../components/ui";
import { useChartTheme } from "../../context/ThemeContext";
import useListViewPreference from "../../hooks/useListViewPreference";
import { buildRiskQueue, latestSubmittedAttempts } from "../../lib/integrityRisk";
import { ALL_RISK_FILTERS, RISK_LEVELS, filterRiskReview, riskFilterOptions } from "../../lib/riskReviewFilters";
import { fetchRowsByIds } from "../../lib/fetchAllRows";
import { getListPageSlice } from "../../lib/listView";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";
import { ALL_FILTERS, ALL_RECORD_FILTERS, RECORD_EVIDENCE, VIOLATION_DATE_RANGES, countByViolationType, filterRecords, filterViolations, violationFilterOptions } from "../../lib/violationFilters";

const violationLabels = {
  MULTIPLE_FACE: "Multiple face detected",
  NO_FACE: "No face detected",
  BACKGROUND_VOICE: "Background voice detected",
  LOUD_NOISE_DETECTED: "Background voice detected",
  AUDIO_DETECTED: "Background voice detected",
  LOUD_AUDIO: "Loud audio detected",
  TAB_SWITCH: "Tab switch attempt",
  COPY_ATTEMPT: "Copy attempt detected",
  FULLSCREEN_EXIT: "Fullscreen exit detected",
  LOOKING_AWAY: "Looking away repeatedly",
  PHONE_DETECTED: "Cellphone detected",
  GADGET_DETECTED: "Spare gadget detected",

  NOTES_DETECTED: "Notes or papers detected",
  MICROPHONE_UNAVAILABLE: "Microphone unavailable",
  MICROPHONE_DISCONNECTED: "Microphone disconnected",
  MICROPHONE_MUTED: "Microphone muted or silent",
  MICROPHONE_ACCESS_LOST: "Microphone access lost",
};

function severityTone(severity) {
  if (severity === "High") return "danger";
  if (severity === "Medium") return "warn";
  return "neutral";
}

function formatDateTime(value) {
  if (!value) return { date: "-", time: "-" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "-", time: "-" };
  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

function EvidenceCell({ row }) {
  const [signedUrl, setSignedUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const signingRef = useRef(false);

  if (!row.evidencePath || !row.evidenceBucket) return "-";

  async function loadEvidence() {
    if (signedUrl || loading || signingRef.current) return;
    const pendingWindow = row.evidenceKind === "audio" ? null : window.open("", "_blank");
    if (pendingWindow) pendingWindow.opener = null;
    signingRef.current = true;
    setLoading(true);
    setErrorMessage("");
    const { data, error } = await supabase.storage.from(row.evidenceBucket).createSignedUrl(row.evidencePath, 60 * 60);
    signingRef.current = false;
    setLoading(false);
    if (error) {
      pendingWindow?.close();
      setErrorMessage(error.message);
      toast.error(error.message);
      return;
    }
    const nextUrl = data?.signedUrl || "";
    if (!nextUrl) {
      pendingWindow?.close();
      setErrorMessage("Evidence URL could not be generated.");
      toast.error("Evidence URL could not be generated.");
      return;
    }
    setSignedUrl(nextUrl);
    if (pendingWindow) pendingWindow.location.href = nextUrl;
  }

  if (signedUrl && row.evidenceKind === "audio") {
    return <audio className="dean-integrity-audio" controls src={signedUrl}>Audio evidence</audio>;
  }

  if (signedUrl) {
    return <a className="dean-integrity-link" href={signedUrl} rel="noreferrer" target="_blank">View</a>;
  }

  return (
    <button className="dean-integrity-link" disabled={loading} onClick={loadEvidence} type="button">
      {loading ? "Loading..." : errorMessage ? "Retry" : row.evidenceKind === "audio" ? "Load audio" : "View"}
    </button>
  );
}

// Shared by the dean and professor Exam Integrity pages. Row-level security limits a professor to the violations
// and attempts of their own exams; the professor page also gets the dean dashboard's Violation Analytics filters.
export default function DeanExamIntegrity({ scope = "dean" }) {
  const isProfessor = scope === "professor";
  const chartTheme = useChartTheme();
  const [violations, setViolations] = useState([]);
  const [risk, setRisk] = useState(null);
  const [loading, setLoading] = useState(Boolean(hasSupabaseConfig));
  const [loadError, setLoadError] = useState("");
  // Each panel has its own filters: Violation Analytics (professor page), Risk review and Integrity Records.
  const [filters, setFilters] = useState(ALL_FILTERS);
  const [riskFilters, setRiskFilters] = useState(ALL_RISK_FILTERS);
  const [recordFilters, setRecordFilters] = useState(ALL_RECORD_FILTERS);
  const [page, setPage] = useState(1);
  const listView = useListViewPreference({ role: scope, page: "exam-integrity", defaultView: "table" });

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setLoading(false);
      return undefined;
    }

    async function loadViolations() {
      setLoading(true);
      setLoadError("");
      const { data, error } = await supabase
        .from("violations")
        .select("id, student_id, exam_id, violation_type, description, severity, screenshot_url, evidence_url, evidence_type, audio_level, created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) {
        setLoadError(error.message);
        setLoading(false);
        toast.error(error.message);
        return;
      }

      const examIds = [...new Set((data || []).map((row) => row.exam_id).filter(Boolean))];

      // Looked up in batches of ids and read in full (the API returns at most 1000 rows per request).
      const [examsResponse, attemptsResponse] = await Promise.all([
        fetchRowsByIds(examIds, (ids, options) => supabase.from("exams").select("id, title, duration, time_limit, course_id", options).in("id", ids).order("id")),
        fetchRowsByIds(examIds, (ids, options) => supabase.from("exam_attempts").select("id, exam_id, student_id, score, status, started_at, submitted_at", options).in("exam_id", ids).order("id")),
      ]);
      const finalAttempts = latestSubmittedAttempts(attemptsResponse.data || []);
      const studentIds = [...new Set([...(data || []), ...finalAttempts].map((row) => row.student_id).filter(Boolean))];
      const courseIds = [...new Set((examsResponse.data || []).map((exam) => exam.course_id).filter(Boolean))];
      const [profilesResponse, coursesResponse] = await Promise.all([
        fetchRowsByIds(studentIds, (ids, options) => supabase.from("profiles").select("id, full_name, student_number, email", options).in("id", ids).order("id")),
        fetchRowsByIds(courseIds, (ids, options) => supabase.from("courses").select("id, course_code, section, course_name", options).in("id", ids).order("id")),
      ]);

      const profilesById = new Map((profilesResponse.data || []).map((profile) => [profile.id, profile]));
      const examsById = new Map((examsResponse.data || []).map((exam) => [exam.id, exam]));
      const coursesById = new Map((coursesResponse.data || []).map((course) => [course.id, course]));

      const durationByExam = Object.fromEntries((examsResponse.data || []).map((exam) => [exam.id, Number(exam.duration || exam.time_limit) || null]));
      const queue = buildRiskQueue({ attempts: finalAttempts, violations: data || [], durationByExam });
      // Kept whole so the Risk review's own filters can narrow the queue, the counts and the charts together.
      setRisk({
        rows: queue.map((row) => {
          const profile = profilesById.get(row.studentId);
          const exam = examsById.get(row.examId);
          const course = exam?.course_id ? coursesById.get(exam.course_id) : null;
          return {
            ...row,
            studentName: profile?.full_name || profile?.email || "Unknown student",
            studentDetail: profile?.student_number || "",
            examTitle: exam?.title || "Unknown exam",
            courseLabel: course ? [course.course_code || course.course_name, course.section].filter(Boolean).join(" - ") : "",
          };
        }),
        violations: data || [],
        attempts: finalAttempts,
      });

      const rows = (data || []).map((violation) => {
        const { date, time } = formatDateTime(violation.created_at);
        const profile = profilesById.get(violation.student_id);
        const exam = examsById.get(violation.exam_id);
        const course = exam?.course_id ? coursesById.get(exam.course_id) : null;
        const evidencePath = violation.evidence_url || violation.screenshot_url;
        const isAudio = violation.evidence_type === "audio" || /\.(webm|mp3|wav|m4a|ogg)$/i.test(evidencePath || "");

        return {
          id: violation.id,
          student: profile?.full_name || profile?.email || "Unknown student",
          studentNumber: profile?.student_number || "-",
          exam: exam?.title || "Unknown exam",
          course: course ? [course.course_code || course.course_name, course.section].filter(Boolean).join(" - ") : "-",
          timestamp: new Date(violation.created_at).getTime() || 0,
          violationType: violationLabels[violation.violation_type] || violation.violation_type || "Monitoring alert",
          description: violation.description || (violation.audio_level ? `Audio level: ${violation.audio_level}%` : "-"),
          severity: violation.severity || "Low",
          date,
          time,
          evidencePath,
          evidenceBucket: evidencePath ? (isAudio ? "audio-violations" : "proctor-snapshots") : "",
          evidenceKind: isAudio ? "audio" : "snapshot",
          hasEvidence: Boolean(evidencePath),
        };
      });

      setViolations(rows);
      setLoading(false);
    }

    loadViolations();

    const channel = supabase
      .channel(isProfessor ? "professor-exam-integrity" : "dean-exam-integrity")
      .on("postgres_changes", { event: "*", schema: "public", table: "violations" }, () => {
        loadViolations();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isProfessor]);

  const filteredViolations = useMemo(() => filterViolations(violations, filters), [filters, violations]);
  const filterOptions = useMemo(() => violationFilterOptions(violations, filters.course), [filters.course, violations]);
  const filteredRecords = useMemo(() => filterRecords(violations, recordFilters), [recordFilters, violations]);
  const recordOptions = useMemo(() => violationFilterOptions(violations, recordFilters.course), [recordFilters.course, violations]);
  const recordsFiltered = JSON.stringify(recordFilters) !== JSON.stringify(ALL_RECORD_FILTERS);
  const setRecordFilter = (key, value) => {
    setRecordFilters((current) => ({ ...current, [key]: value, ...(key === "course" ? { exam: ALL_RECORD_FILTERS.exam } : {}) }));
    setPage(1);
  };
  const riskView = useMemo(() => (risk ? filterRiskReview(risk, riskFilters) : null), [risk, riskFilters]);
  const riskOptions = useMemo(() => riskFilterOptions(risk?.rows, riskFilters.course), [risk, riskFilters.course]);
  const riskFiltered = JSON.stringify(riskFilters) !== JSON.stringify(ALL_RISK_FILTERS);
  const setRiskFilter = (key, value) => {
    setRiskFilters((current) => ({ ...current, [key]: value, ...(key === "course" ? { exam: ALL_RISK_FILTERS.exam } : {}) }));
  };
  const setFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value, ...(key === "course" ? { exam: ALL_FILTERS.exam } : {}) }));
  };

  const highCount = violations.filter((violation) => violation.severity === "High").length;
  const snapshotCount = violations.filter((violation) => violation.hasEvidence).length;
  const examCount = new Set(violations.map((violation) => violation.exam)).size;

  const columns = [
    { key: "student", label: "Student", width: "18%", className: "dean-integrity-primary" },
    { key: "studentNumber", label: "Student ID", width: "10%" },
    { key: "exam", label: "Exam", width: "20%", className: "dean-integrity-primary" },
    { key: "violationType", label: "Violation", width: "18%", className: "dean-integrity-primary" },
    { key: "severity", label: "Severity", width: "10%", render: (row) => <Badge tone={severityTone(row.severity)}>{row.severity}</Badge> },
    { key: "date", label: "Date", width: "10%" },
    { key: "time", label: "Time", width: "8%" },
    {
      key: "snapshot",
      label: "Evidence",
      width: "10%",
      render: (row) => <EvidenceCell row={row} />,
    },
  ];
  const pageData = getListPageSlice(filteredRecords, page, listView.pageSize);

  return (
    <section className="dean-integrity-page">
      <header className="dean-dashboard-header dean-integrity-header">
        <h1>Exam Integrity</h1>
        <p>{isProfessor ? "Review integrity records and monitoring events across your exams." : "Review examination integrity records and recorded monitoring events."}</p>
      </header>

      <div className="dean-kpi-grid dean-integrity-kpi-grid">
        {[
          ["Total Alerts", violations.length, FiActivity],
          ["High Severity", highCount, FiAlertTriangle],
          ["Exams With Alerts", examCount, FiShield],
          ["Evidence Records", snapshotCount, FiCamera],
        ].map(([label, value, Icon]) => (
          <Card className="dean-kpi-card" key={label}>
            <div>
              <span>{label}</span>
              <strong>{loading ? <SkeletonValue /> : value}</strong>
            </div>
            <Icon aria-hidden="true" />
          </Card>
        ))}
      </div>

      {isProfessor ? (
        <>
          <Card className="dean-dashboard-panel dean-dashboard-controls">
            <div className="dean-dashboard-search-row">
              <SearchBox value={filters.search} onChange={(value) => setFilter("search", value)} placeholder="Search students, exams, courses, or violations..." />
              {filters.search ? <Button variant="light" onClick={() => setFilter("search", "")}><FiX /> Clear</Button> : null}
            </div>
            <div className="dean-dashboard-filters">
              <SelectField label="Date Range" value={filters.dateRange} onChange={(event) => setFilter("dateRange", event.target.value)}>
                {VIOLATION_DATE_RANGES.map((range) => <option key={range}>{range}</option>)}
              </SelectField>
              <SelectField label="Course" value={filters.course} onChange={(event) => setFilter("course", event.target.value)}>
                <option>{ALL_FILTERS.course}</option>
                {filterOptions.courses.map((course) => <option key={course}>{course}</option>)}
              </SelectField>
              <SelectField label="Exam" value={filters.exam} onChange={(event) => setFilter("exam", event.target.value)}>
                <option>{ALL_FILTERS.exam}</option>
                {filterOptions.exams.map((exam) => <option key={exam}>{exam}</option>)}
              </SelectField>
              <SelectField label="Violation Type" value={filters.type} onChange={(event) => setFilter("type", event.target.value)}>
                <option>{ALL_FILTERS.type}</option>
                {filterOptions.types.map((type) => <option key={type}>{type}</option>)}
              </SelectField>
              <SelectField label="Severity" value={filters.severity} onChange={(event) => setFilter("severity", event.target.value)}>
                <option>{ALL_FILTERS.severity}</option>
                {filterOptions.severities.map((item) => <option key={item}>{item}</option>)}
              </SelectField>
              <Button variant="light" onClick={() => setFilters(ALL_FILTERS)}>Reset Filters</Button>
            </div>
          </Card>
          <Card className="dean-dashboard-panel dean-analytics-panel">
            <div className="dean-dashboard-section-header">
              <div>
                <h2>Violation Analytics</h2>
                <p>Alerts in your exams that match the filters, by type.</p>
              </div>
              <span>{loading ? <SkeletonValue /> : `${filteredViolations.length} matching records`}</span>
            </div>
            <div className="chart-box dean-chart-box">
              {loading ? <SkeletonBlock className="skeleton-chart" /> : filteredViolations.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={countByViolationType(filteredViolations)}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                    <XAxis axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} dataKey="name" interval={0} height={WRAPPED_AXIS_HEIGHT} tick={<WrappedAxisTick fill={chartTheme.axis} />} />
                    <YAxis allowDecimals={false} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} tick={{ fill: chartTheme.axis }} />
                    <Tooltip cursor={{ fill: chartTheme.cursor }} contentStyle={{ background: chartTheme.tooltipBackground, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 14, color: chartTheme.tooltipText }} itemStyle={{ color: chartTheme.tooltipText }} labelStyle={{ color: chartTheme.tooltipText }} />
                    <Bar dataKey="count" fill="#06b6d4" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyState title="No matching records found." description="Adjust the search or filters to show analytics." />}
            </div>
          </Card>
        </>
      ) : null}

      <Card className="dean-dashboard-panel dean-integrity-risk-panel">
        <div className="dean-dashboard-section-header">
          <div>
            <h2>Risk review</h2>
            <p>Attempts in exams with recent alerts, ordered by integrity risk.</p>
          </div>
        </div>
        {loadError ? null : loading || !riskView ? (
          <ListSkeleton columns={5} label="Loading risk review..." variant="table" />
        ) : (
          <>
            {/* The Risk review's own filters: they do not change, and are not changed by, the filters above. */}
            <div className="dean-integrity-risk-filters">
              <SearchBox value={riskFilters.search} onChange={(value) => setRiskFilter("search", value)} placeholder="Search student, ID, exam, or course" />
              <SelectField label="Course" value={riskFilters.course} onChange={(event) => setRiskFilter("course", event.target.value)}>
                <option>{ALL_RISK_FILTERS.course}</option>
                {riskOptions.courses.map((item) => <option key={item}>{item}</option>)}
              </SelectField>
              <SelectField label="Exam" value={riskFilters.exam} onChange={(event) => setRiskFilter("exam", event.target.value)}>
                <option>{ALL_RISK_FILTERS.exam}</option>
                {riskOptions.exams.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </SelectField>
              <SelectField label="Risk Level" value={riskFilters.level} onChange={(event) => setRiskFilter("level", event.target.value)}>
                {RISK_LEVELS.map((item) => <option key={item} value={item}>{item === "All" ? "All Levels" : item}</option>)}
              </SelectField>
              <Button variant="light" disabled={!riskFiltered} onClick={() => setRiskFilters(ALL_RISK_FILTERS)}>Reset</Button>
            </div>
            <IntegrityReview
              key={JSON.stringify(riskFilters)}
              basis="Based on the latest 500 alerts."
              emptyMessage={riskFiltered ? "No attempts match these filters." : "No submitted attempts or monitoring alerts yet."}
              filtered
              rows={riskView.rows}
              showExam
              summary={riskView.summary}
            />
          </>
        )}
      </Card>

      <Card className="dean-dashboard-panel dean-integrity-records-panel">
        <div className="dean-dashboard-section-header">
          <div>
            <h2>Integrity Records</h2>
            <p>Showing the latest capped monitoring records with evidence available on request.</p>
          </div>
          <span>{loading ? <SkeletonValue /> : `${filteredRecords.length} records`}</span>
        </div>
        {/* Integrity Records' own filters: they do not change, and are not changed by, the other panels' filters. */}
        <div className="dean-integrity-records-filters">
          <div className="dean-integrity-search-row">
            <SearchBox value={recordFilters.search} onChange={(value) => setRecordFilter("search", value)} placeholder="Search student, ID, exam, course, or violation" />
          </div>
          <div className="dean-integrity-filter-row">
            <SelectField label="Date Range" value={recordFilters.dateRange} onChange={(event) => setRecordFilter("dateRange", event.target.value)}>
              {VIOLATION_DATE_RANGES.map((item) => <option key={item}>{item}</option>)}
            </SelectField>
            <SelectField label="Course" value={recordFilters.course} onChange={(event) => setRecordFilter("course", event.target.value)}>
              <option>{ALL_RECORD_FILTERS.course}</option>
              {recordOptions.courses.map((item) => <option key={item}>{item}</option>)}
            </SelectField>
            <SelectField label="Exam" value={recordFilters.exam} onChange={(event) => setRecordFilter("exam", event.target.value)}>
              <option>{ALL_RECORD_FILTERS.exam}</option>
              {recordOptions.exams.map((item) => <option key={item}>{item}</option>)}
            </SelectField>
            <SelectField label="Violation Type" value={recordFilters.type} onChange={(event) => setRecordFilter("type", event.target.value)}>
              <option>{ALL_RECORD_FILTERS.type}</option>
              {recordOptions.types.map((item) => <option key={item}>{item}</option>)}
            </SelectField>
            <SelectField label="Severity" value={recordFilters.severity} onChange={(event) => setRecordFilter("severity", event.target.value)}>
              <option>{ALL_RECORD_FILTERS.severity}</option>
              {recordOptions.severities.map((item) => <option key={item}>{item}</option>)}
            </SelectField>
            <SelectField label="Evidence" value={recordFilters.evidence} onChange={(event) => setRecordFilter("evidence", event.target.value)}>
              {RECORD_EVIDENCE.map((item) => <option key={item}>{item}</option>)}
            </SelectField>
            <Button variant="light" disabled={!recordsFiltered} onClick={() => { setRecordFilters(ALL_RECORD_FILTERS); setPage(1); }}>Reset</Button>
          </div>
        </div>
        <ListViewToolbar
          controls={{
            cardDensity: listView.cardDensity,
            onCardDensity: listView.setCardDensity,
            onTableDensity: listView.setTableDensity,
            onView: (nextView) => setPage(listView.switchViewPreservingPage(nextView, pageData.page, filteredRecords.length)),
            tableDensity: listView.tableDensity,
            view: listView.view,
          }}
        />
        {loadError ? (
          <div className="dean-integrity-state dean-integrity-error" role="alert">
            <strong>Unable to load integrity records.</strong>
            <span>{loadError}</span>
          </div>
        ) : loading ? (
          <ListSkeleton
            columns={listView.view === "cards" ? 4 : Math.min(columns.length, 6)}
            label="Loading integrity records..."
            variant={listView.view === "cards" ? "records" : "table"}
          />
        ) : (
          <div className="dean-integrity-table-scroll">
          {listView.view === "cards" ? (
            <RecordCardList
              columns={columns}
              density={listView.cardDensity}
              empty={<EmptyState title="No integrity records match the current filters." description="Adjust search or filters to review records." />}
              rows={pageData.rows}
              titleKey="student"
            />
          ) : (
            <Table
              className={`dean-integrity-table list-table-${listView.tableDensity}`}
              columns={columns}
              emptyDescription="Adjust search or filters to review records."
              emptyTitle="No integrity records match the current filters."
              rows={pageData.rows}
            />
          )}
          </div>
        )}
        {!loadError && !loading ? (
          <ListPagination count={filteredRecords.length} page={pageData.page} pageSize={listView.pageSize} onPage={setPage} />
        ) : null}
      </Card>
    </section>
  );
}
