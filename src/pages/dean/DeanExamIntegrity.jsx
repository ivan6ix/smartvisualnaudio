import { useEffect, useMemo, useRef, useState } from "react";
import { FiActivity, FiAlertTriangle, FiCamera, FiShield, FiX } from "react-icons/fi";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import IntegrityReview from "../../components/exam/IntegrityReview";
import { ListPagination, ListViewToolbar, RecordCardList } from "../../components/ListViewControls";
import { Badge, Button, Card, EmptyState, ListSkeleton, SearchBox, SelectField, SkeletonBlock, SkeletonValue, Table } from "../../components/ui";
import { useChartTheme } from "../../context/ThemeContext";
import useListViewPreference from "../../hooks/useListViewPreference";
import { buildRiskQueue, latestSubmittedAttempts, summarizeIntegrity } from "../../lib/integrityRisk";
import { fetchRowsByIds } from "../../lib/fetchAllRows";
import { getListPageSlice } from "../../lib/listView";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";
import { ALL_FILTERS, VIOLATION_DATE_RANGES, countByViolationType, filterViolations, violationFilterOptions } from "../../lib/violationFilters";

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
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [severity, setSeverity] = useState("All Severities");
  const [filters, setFilters] = useState(ALL_FILTERS);
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
      setRisk({
        rows: queue.map((row) => {
          const profile = profilesById.get(row.studentId);
          return {
            ...row,
            studentName: profile?.full_name || profile?.email || "Unknown student",
            studentDetail: profile?.student_number || "",
            examTitle: examsById.get(row.examId)?.title || "Unknown exam",
          };
        }),
        summary: summarizeIntegrity({ queue, violations: data || [], attempts: finalAttempts }),
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

  const filteredViolations = useMemo(() => (isProfessor ? filterViolations(violations, filters) : violations.filter((violation) => {
    const matchesSeverity = severity === "All Severities" || violation.severity === severity;
    const matchesSearch = `${violation.student} ${violation.studentNumber} ${violation.exam} ${violation.violationType}`.toLowerCase().includes(search.toLowerCase());
    return matchesSeverity && matchesSearch && (typeFilter === "All" || violation.violationType === typeFilter);
  })), [filters, isProfessor, search, severity, violations, typeFilter]);
  const filterOptions = useMemo(() => violationFilterOptions(violations, filters.course), [filters.course, violations]);
  const setFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value, ...(key === "course" ? { exam: ALL_FILTERS.exam } : {}) }));
    setPage(1);
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
  const pageData = getListPageSlice(filteredViolations, page, listView.pageSize);

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
              <Button variant="light" onClick={() => { setFilters(ALL_FILTERS); setPage(1); }}>Reset Filters</Button>
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
                    <XAxis axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} dataKey="name" tick={{ fontSize: 11, fill: chartTheme.axis }} />
                    <YAxis allowDecimals={false} axisLine={{ stroke: chartTheme.grid }} tickLine={{ stroke: chartTheme.grid }} tick={{ fill: chartTheme.axis }} />
                    <Tooltip cursor={{ fill: chartTheme.cursor }} contentStyle={{ background: chartTheme.tooltipBackground, border: `1px solid ${chartTheme.tooltipBorder}`, borderRadius: 14, color: chartTheme.tooltipText }} itemStyle={{ color: chartTheme.tooltipText }} labelStyle={{ color: chartTheme.tooltipText }} />
                    <Bar dataKey="count" fill="#06b6d4" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <EmptyState title="No matching records found." description="Adjust the search or filters to show analytics." />}
            </div>
          </Card>
        </>
      ) : (
        <Card className="dean-dashboard-panel dean-integrity-controls">
          <div className="dean-integrity-search-row">
            <SearchBox value={search} onChange={setSearch} placeholder="Search student, exam, or violation" />
          </div>
          <div className="dean-integrity-filter-row">
            <SelectField label="Severity Filter" value={severity} onChange={(event) => setSeverity(event.target.value)}>
              <option>All Severities</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </SelectField>
            <SelectField label="Violation Type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option>All</option>
              {[...new Set(violations.map((item) => item.violationType))].filter(Boolean).map((type) => <option key={type}>{type}</option>)}
            </SelectField>
          </div>
        </Card>
      )}

      <Card className="dean-dashboard-panel dean-integrity-risk-panel">
        <div className="dean-dashboard-section-header">
          <div>
            <h2>Risk review</h2>
            <p>Attempts in exams with recent alerts, ordered by integrity risk.</p>
          </div>
        </div>
        {loadError ? null : loading || !risk ? (
          <ListSkeleton columns={5} label="Loading risk review..." variant="table" />
        ) : (
          <IntegrityReview basis="Based on the latest 500 alerts." rows={risk.rows} showExam summary={risk.summary} />
        )}
      </Card>

      <Card className="dean-dashboard-panel dean-integrity-records-panel">
        <div className="dean-dashboard-section-header">
          <div>
            <h2>Integrity Records</h2>
            <p>Showing the latest capped monitoring records with evidence available on request.</p>
          </div>
          <span>{loading ? <SkeletonValue /> : `${filteredViolations.length} records`}</span>
        </div>
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
          <ListPagination count={filteredViolations.length} page={pageData.page} pageSize={listView.pageSize} onPage={setPage} />
        ) : null}
      </Card>
    </section>
  );
}
