import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiArrowLeft, FiEye, FiVolume2, FiVolumeX, FiWifi, FiWifiOff } from "react-icons/fi";
import { toast } from "sonner";
import { Badge, Button, Card, SearchBox } from "../../components/ui";
import { hasSupabaseConfig, supabase } from "../../lib/supabase";
import {
  classifyOngoingStudent,
  getNextOngoingTransitionDelay,
  paginateOngoingRows,
  shouldPlayViolationSound,
  sortOngoingRows,
  summarizeOngoingExams,
  VIOLATION_SOUND_COOLDOWN_MS,
} from "../../lib/ongoingExams";

const STATUS_OPTIONS = ["All", "Not Started", "In Progress", "Submitted"];
const SORT_COLUMNS = [
  ["student", "Student"],
  ["status", "Status"],
  ["attempt", "Attempt"],
  ["progress", "Live Progress"],
  ["violations", "Violations"],
];

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function statusTone(status) {
  if (status === "Auto-Submitted" || status === "Interrupted") return "warn";
  if (status === "Submitted") return "success";
  if (status === "In Progress") return "blue";
  return "neutral";
}

function normalizeExam(raw, phase) {
  const students = (raw.students || []).map((student) => {
    const classified = classifyOngoingStudent({
      ...student,
      name: student.studentName,
      attempts: student.attempts || [],
    });
    return {
      ...classified,
      answeredCount: classified.latestAttempt?.answeredCount || 0,
      questionCount: classified.latestAttempt?.questionCount ?? classified.questionCount ?? 0,
    };
  });
  const unique = new Map();
  students.forEach((student) => unique.set(student.studentId, student));
  return { ...raw, phase, students: [...unique.values()] };
}

function examCounters(exam) {
  return summarizeOngoingExams([{ ...exam, phase: "active" }]);
}

function playViolationPing() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.24);
  window.setTimeout(() => void context.close(), 350);
}

export default function ProfessorOngoingExams() {
  const [activeExams, setActiveExams] = useState([]);
  const [upcomingExams, setUpcomingExams] = useState([]);
  const [loading, setLoading] = useState(false);
  const [connectionState, setConnectionState] = useState("Live");
  const [soundMuted, setSoundMuted] = useState(false);
  const [selectedExamId, setSelectedExamId] = useState(null);
  const [expandedStudents, setExpandedStudents] = useState(() => new Set());
  const [expandedViolations, setExpandedViolations] = useState(() => new Set());
  const [tableState, setTableState] = useState({});
  const [highlightedRows, setHighlightedRows] = useState(() => new Set());
  const previousViolationCountsRef = useRef(new Map());
  const lastSoundAtRef = useRef(0);

  const allExamWindows = useMemo(() => [...activeExams, ...upcomingExams], [activeExams, upcomingExams]);
  const summary = useMemo(() => summarizeOngoingExams(activeExams), [activeExams]);
  const selectedExam = useMemo(() => activeExams.find((exam) => exam.id === selectedExamId) || null, [activeExams, selectedExamId]);

  const loadOngoing = useCallback(async ({ initial = false } = {}) => {
    if (!hasSupabaseConfig) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_professor_ongoing_exams");
      if (error) throw error;
      const nextActive = (data?.active || []).map((exam) => normalizeExam(exam, "active"));
      const nextUpcoming = (data?.upcoming || []).map((exam) => ({ id: exam.id, startsAt: exam.startsAt, deadline: exam.deadline }));
      const nextViolationCounts = new Map();
      const newlyFlagged = [];
      nextActive.forEach((exam) => {
        exam.students.forEach((student) => {
          const key = `${exam.id}:${student.studentId}`;
          const count = Number(student.violationCount || 0);
          const previous = previousViolationCountsRef.current.get(key);
          nextViolationCounts.set(key, count);
          if (!initial && previous !== undefined && count > previous) newlyFlagged.push(key);
        });
      });
      previousViolationCountsRef.current = nextViolationCounts;
      if (newlyFlagged.length) {
        setHighlightedRows(new Set(newlyFlagged));
        window.setTimeout(() => setHighlightedRows(new Set()), 2400);
        if (!soundMuted && shouldPlayViolationSound(lastSoundAtRef.current)) {
          playViolationPing();
          lastSoundAtRef.current = Date.now();
        }
      }
      setActiveExams(nextActive);
      setUpcomingExams(nextUpcoming);
      if (initial) setSelectedExamId(null);
      setSelectedExamId((current) => current && nextActive.some((exam) => exam.id === current) ? current : null);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, [soundMuted]);

  useEffect(() => {
    if (!hasSupabaseConfig) return;
    void loadOngoing({ initial: true });
  }, [loadOngoing]);

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined;
    const channel = supabase
      .channel("professor-ongoing-exams")
      .on("postgres_changes", { event: "*", schema: "public", table: "exam_start_sessions" }, () => void loadOngoing())
      .on("postgres_changes", { event: "*", schema: "public", table: "exam_attempts" }, () => void loadOngoing())
      .on("postgres_changes", { event: "*", schema: "public", table: "exam_attempt_answers" }, () => void loadOngoing())
      .on("postgres_changes", { event: "*", schema: "public", table: "violations" }, () => void loadOngoing())
      .on("postgres_changes", { event: "*", schema: "public", table: "exam_student_assignments" }, () => void loadOngoing())
      .on("postgres_changes", { event: "*", schema: "public", table: "exam_student_access_exceptions" }, () => void loadOngoing())
      .subscribe((status) => {
        setConnectionState(status === "SUBSCRIBED" ? "Live" : "Reconnecting");
        if (status === "SUBSCRIBED") void loadOngoing();
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadOngoing]);

  useEffect(() => {
    const delay = getNextOngoingTransitionDelay(allExamWindows.map((exam) => ({ startsAt: exam.startsAt, deadline: exam.deadline })));
    if (!delay) return undefined;
    const timer = window.setTimeout(() => void loadOngoing(), delay + 250);
    return () => window.clearTimeout(timer);
  }, [allExamWindows, loadOngoing]);

  function updateTable(examId, patch) {
    setTableState((current) => ({ ...current, [examId]: { search: "", status: "All", sortKey: "student", sortDirection: "asc", page: 1, ...(current[examId] || {}), ...patch } }));
  }

  const openExam = useCallback((examId) => {
    setSelectedExamId(examId);
    setExpandedStudents(new Set());
    setExpandedViolations(new Set());
  }, []);

  const backToList = useCallback(() => {
    setSelectedExamId(null);
    setExpandedStudents(new Set());
    setExpandedViolations(new Set());
  }, []);

  function toggleSet(setter, id) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="professor-ongoing-section">
      <Card className="professor-ongoing-card">
        <div className="professor-ongoing-header">
          <div>
            <h2>Ongoing Exams</h2>
            <p>Live operational view of exams currently inside their normal active window.</p>
          </div>
          <div className="professor-ongoing-live">
            <span className={connectionState === "Live" ? "live" : "reconnecting"}>{connectionState === "Live" ? <FiWifi /> : <FiWifiOff />}{connectionState}</span>
            <button aria-label={soundMuted ? "Unmute violation sound" : "Mute violation sound"} onClick={() => setSoundMuted((value) => !value)} type="button">
              {soundMuted ? <FiVolumeX /> : <FiVolume2 />} {soundMuted ? "Muted" : "Sound On"}
            </button>
          </div>
        </div>

        <div className="professor-ongoing-summary">
          {[
            ["Active Exams", summary.activeExams],
            ["Assigned", summary.assigned],
            ["Not Started", summary.notStarted],
            ["In Progress", summary.inProgress],
            ["Submitted", summary.submitted],
            ["Violations", summary.violations],
          ].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
        </div>

        {!selectedExam ? (
          <ActiveExamList exams={activeExams} loading={loading} onView={openExam} />
        ) : (
          <ExamDetail
            exam={selectedExam}
            expandedStudents={expandedStudents}
            expandedViolations={expandedViolations}
            highlightedRows={highlightedRows}
            tableState={tableState}
            toggleStudent={(id) => toggleSet(setExpandedStudents, id)}
            toggleViolations={(id) => toggleSet(setExpandedViolations, id)}
            updateTable={updateTable}
            onBack={backToList}
          />
        )}
      </Card>

      <small className="professor-ongoing-note">Violation sound is rate-limited to one alert every {VIOLATION_SOUND_COOLDOWN_MS / 1000}s.</small>
    </section>
  );
}

function ActiveExamList({ exams, loading, onView }) {
  const sortedExams = useMemo(() => [...exams].sort((first, second) => (
    new Date(first.deadline || 8640000000000000) - new Date(second.deadline || 8640000000000000)
  )), [exams]);

  if (!loading && !sortedExams.length) {
    return (
      <div className="professor-exams-empty">
        <strong>No ongoing exams.</strong>
        <span>There are currently no active exams within their scheduled examination period.</span>
      </div>
    );
  }

  return (
    <div className="professor-ongoing-list">
      {sortedExams.map((exam) => <ExamCard key={exam.id} exam={exam} onView={onView} />)}
    </div>
  );
}

function ExamCard({ exam, onView }) {
  const counters = examCounters(exam);
  return (
    <article className="professor-ongoing-exam-card">
      <div className="professor-ongoing-exam-main">
        <strong>{exam.title}</strong>
        <span>{exam.courseCode || exam.courseName || "No course"}{exam.section ? ` · ${exam.section}` : ""}</span>
        <small>{exam.examType || "Exam"} · {formatDateTime(exam.startsAt)} – {formatDateTime(exam.deadline)}</small>
      </div>
      <div className="professor-ongoing-card-meta">
        <span><strong>{counters.assigned}</strong> Assigned</span>
        <span><strong>{counters.inProgress}</strong> In Progress</span>
        <span><strong>{counters.submitted}</strong> Submitted</span>
        <span><strong>{counters.violations}</strong> With Violations</span>
      </div>
      <Button onClick={() => onView(exam.id)}><FiEye /> View</Button>
    </article>
  );
}

function ExamDetail({ exam, expandedStudents, expandedViolations, highlightedRows, tableState, toggleStudent, toggleViolations, updateTable, onBack }) {
  const counters = examCounters(exam);
  const state = { search: "", status: "All", sortKey: "student", sortDirection: "asc", page: 1, ...(tableState[exam.id] || {}) };
  const rows = useMemo(() => {
    const term = state.search.trim().toLowerCase();
    const filtered = exam.students
      .filter((student) => !term || `${student.studentName} ${student.studentNumber || ""}`.toLowerCase().includes(term))
      .filter((student) => state.status === "All" || (state.status === "In Progress" ? ["In Progress", "Interrupted"].includes(student.status) : state.status === "Submitted" ? ["Submitted", "Auto-Submitted"].includes(student.status) : student.status === state.status));
    return sortOngoingRows(filtered, state.sortKey, state.sortDirection);
  }, [exam.students, state.search, state.sortDirection, state.sortKey, state.status]);
  const totalPages = Math.max(1, Math.ceil(rows.length / 20));
  const page = Math.min(state.page, totalPages);
  const pageRows = paginateOngoingRows(rows, page, 20);

  return (
    <article className="professor-ongoing-detail">
      <header>
        <Button variant="light" onClick={onBack}><FiArrowLeft /> Back to Ongoing Exams</Button>
        <div>
          <strong>{exam.title}</strong>
          <span>{exam.courseCode || exam.courseName || "No course"} · {exam.section || "No section"} · {exam.examType || "Exam"}</span>
          <small>Start {formatDateTime(exam.startsAt)} · Deadline {formatDateTime(exam.deadline)}</small>
        </div>
        <Badge tone="blue">Active</Badge>
        <div className="professor-ongoing-mini">
          <span>{counters.assigned} Assigned</span><span>{counters.notStarted} Not Started</span><span>{counters.inProgress} In Progress</span><span>{counters.submitted} Submitted</span><span>{counters.violations} With Violations</span>
        </div>
      </header>
      <div className="professor-ongoing-expanded">
        <div className="professor-score-filters compact">
          <SearchBox value={state.search} onChange={(value) => updateTable(exam.id, { search: value, page: 1 })} placeholder="Search student" />
          <label className="field"><span>Status</span><select value={state.status} onChange={(event) => updateTable(exam.id, { status: event.target.value, page: 1 })}>{STATUS_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label className="field"><span>Sort</span><select value={state.sortKey} onChange={(event) => updateTable(exam.id, { sortKey: event.target.value })}>{SORT_COLUMNS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="field"><span>Direction</span><select value={state.sortDirection} onChange={(event) => updateTable(exam.id, { sortDirection: event.target.value })}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
        </div>
        <StudentsTable exam={exam} rows={pageRows} expandedStudents={expandedStudents} expandedViolations={expandedViolations} highlightedRows={highlightedRows} toggleStudent={toggleStudent} toggleViolations={toggleViolations} />
        {rows.length > 20 ? <div className="professor-attempt-pagination"><button disabled={page <= 1} onClick={() => updateTable(exam.id, { page: page - 1 })} type="button">Previous</button><span>Page {page} of {totalPages}</span><button disabled={page >= totalPages} onClick={() => updateTable(exam.id, { page: page + 1 })} type="button">Next</button></div> : null}
      </div>
    </article>
  );
}

function StudentsTable({ exam, rows, expandedStudents, expandedViolations, highlightedRows, toggleStudent, toggleViolations }) {
  return (
    <div className="professor-score-table-wrap professor-ongoing-table-wrap">
      <table className="professor-score-table compact professor-ongoing-table">
        <thead><tr><th>Student</th><th>Status</th><th>Attempt</th><th>Live Progress</th><th>Violations</th></tr></thead>
        <tbody>
          {rows.map((student) => {
            const rowKey = `${exam.id}:${student.studentId}`;
            const attemptsExpanded = expandedStudents.has(rowKey);
            const violationsExpanded = expandedViolations.has(rowKey);
            return (
              <Fragment key={rowKey}>
                <tr key={rowKey} className={highlightedRows.has(rowKey) ? "violation-highlight" : ""}>
                  <td><strong>{student.studentName}</strong><span>{student.studentNumber || "No student ID"}</span></td>
                  <td><Badge tone={statusTone(student.status)}>{student.status}</Badge></td>
                  <td>{student.attemptNumber ? <button className="professor-score-link-button" onClick={() => toggleStudent(rowKey)} type="button">Attempt {student.attemptNumber} {student.attempts?.length > 1 ? (attemptsExpanded ? "Hide" : "Show") : ""}</button> : "-"}</td>
                  <td>{Number(student.answeredCount || student.latestAttempt?.answeredCount || 0)} Answered / {Math.max(0, Number(student.questionCount || 0) - Number(student.answeredCount || student.latestAttempt?.answeredCount || 0))} Remaining</td>
                  <td><button className="professor-score-link-button" disabled={!student.violationCount} onClick={() => toggleViolations(rowKey)} type="button">{student.violationCount || 0} Violations {student.violationCount ? (violationsExpanded ? "Hide" : "Show") : ""}</button></td>
                </tr>
                {attemptsExpanded ? <AttemptHistoryRow key={`${rowKey}:attempts`} attempts={student.attempts || []} /> : null}
                {violationsExpanded ? <ViolationHistoryRow key={`${rowKey}:violations`} violations={student.violations || []} /> : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {!rows.length ? <div className="professor-exams-empty">No students match this view.</div> : null}
    </div>
  );
}

function AttemptHistoryRow({ attempts }) {
  return (
    <tr className="professor-ongoing-subrow"><td colSpan={5}>
      <div>{attempts.map((attempt) => <span key={attempt.id}>Attempt {attempt.attemptNumber}: {attempt.status} · {attempt.answeredCount || 0}/{attempt.questionCount || 0} answered · {attempt.submitted_at ? formatDateTime(attempt.submitted_at) : "not submitted"} · {attempt.violationCount || 0} violations</span>)}</div>
    </td></tr>
  );
}

function ViolationHistoryRow({ violations }) {
  return (
    <tr className="professor-ongoing-subrow"><td colSpan={5}>
      <div>{violations.map((violation) => <span key={violation.id}>{violation.violation_type || "Violation"} · {formatDateTime(violation.created_at)} · {violation.description || "No details"}{violation.evidence_url || violation.screenshot_url ? " · Evidence recorded" : ""}</span>)}</div>
    </td></tr>
  );
}
