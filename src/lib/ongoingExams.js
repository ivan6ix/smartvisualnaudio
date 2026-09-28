export const ONGOING_PAGE_SIZE = 20;
export const VIOLATION_SOUND_COOLDOWN_MS = 4500;

const statusRank = {
  "Not Started": 0,
  "In Progress": 1,
  Interrupted: 1,
  Submitted: 2,
  "Auto-Submitted": 2,
};

export function isPublishedStatus(status) {
  return ["published", "active"].includes(String(status || "").toLowerCase());
}

export function getExamWindow(exam = {}) {
  const settings = exam.exam_settings || exam.examSettings || {};
  return {
    startsAt: settings.startsAt || exam.startsAt || null,
    deadline: settings.deadline || exam.deadline || null,
  };
}

export function getOngoingExamPhase(exam, dismissedExamIds = new Set(), now = Date.now()) {
  if (!exam?.id || dismissedExamIds.has(exam.id)) return "hidden";
  if (!isPublishedStatus(exam.status)) return "hidden";
  const settings = exam.exam_settings || {};
  if (settings.archived) return "hidden";
  const { startsAt, deadline } = getExamWindow(exam);
  const startTime = startsAt ? new Date(startsAt).getTime() : null;
  const deadlineTime = deadline ? new Date(deadline).getTime() : null;
  if (startTime && Number.isFinite(startTime) && startTime > now) return "upcoming";
  if (deadlineTime && Number.isFinite(deadlineTime) && deadlineTime <= now) return "finished";
  return "active";
}

export function classifyOngoingStudent(student = {}) {
  const attempts = [...(student.attempts || [])].sort((first, second) => (
    Number(second.attemptNumber || 0) - Number(first.attemptNumber || 0)
    || new Date(second.submitted_at || second.started_at || 0) - new Date(first.submitted_at || first.started_at || 0)
  ));
  const latestAttempt = attempts[0] || null;
  const start = student.start || null;
  const latestAttemptStartedAt = latestAttempt?.submission_session_started_at || latestAttempt?.started_at;
  const startTime = start?.started_at ? new Date(start.started_at).getTime() : null;
  const latestSessionTime = latestAttemptStartedAt ? new Date(latestAttemptStartedAt).getTime() : null;
  const hasOpenSession = startTime && (!latestSessionTime || startTime > latestSessionTime || latestAttempt?.status === "Reopened");

  if (hasOpenSession) {
    const interrupted = Number(start.interruption_count || 0) > Number(start.interruption_limit || 3);
    return { ...student, status: interrupted ? "Interrupted" : "In Progress", latestAttempt, attemptNumber: latestAttempt?.attemptNumber || attempts.length + 1 };
  }
  if (latestAttempt) {
    const autoSubmitted = latestAttempt.submission_reason === "violation_limit";
    return { ...student, status: autoSubmitted ? "Auto-Submitted" : "Submitted", latestAttempt, attemptNumber: latestAttempt.attemptNumber || attempts.length };
  }
  return { ...student, status: "Not Started", latestAttempt: null, attemptNumber: 0 };
}

export function summarizeOngoingExams(exams = []) {
  const active = exams.filter((exam) => exam.phase === "active");
  return active.reduce((summary, exam) => {
    const studentsById = new Map();
    for (const student of exam.students || []) studentsById.set(student.studentId, student);
    const students = [...studentsById.values()];
    summary.activeExams += 1;
    summary.assigned += students.length;
    summary.notStarted += students.filter((student) => student.status === "Not Started").length;
    summary.inProgress += students.filter((student) => student.status === "In Progress" || student.status === "Interrupted").length;
    summary.submitted += students.filter((student) => student.status === "Submitted" || student.status === "Auto-Submitted").length;
    summary.violations += students.filter((student) => Number(student.violationCount || 0) > 0).length;
    return summary;
  }, { activeExams: 0, assigned: 0, notStarted: 0, inProgress: 0, submitted: 0, violations: 0 });
}

export function sortOngoingRows(rows = [], key = "student", direction = "asc") {
  const multiplier = direction === "desc" ? -1 : 1;
  const valueFor = (row) => {
    if (key === "student") return String(row.studentName || row.name || "").toLowerCase();
    if (key === "status") return statusRank[row.status] ?? 99;
    if (key === "attempt") return Number(row.attemptNumber || 0);
    if (key === "progress") return Number(row.answeredCount || 0) / Math.max(1, Number(row.questionCount || 0));
    if (key === "violations") return Number(row.violationCount || 0);
    return String(row[key] || "").toLowerCase();
  };
  return [...rows].sort((first, second) => {
    const a = valueFor(first);
    const b = valueFor(second);
    if (typeof a === "number" && typeof b === "number") return (a - b) * multiplier;
    return String(a).localeCompare(String(b)) * multiplier;
  });
}

export function paginateOngoingRows(rows = [], page = 1, pageSize = ONGOING_PAGE_SIZE) {
  const safePage = Math.max(1, Number(page) || 1);
  return rows.slice((safePage - 1) * pageSize, safePage * pageSize);
}

export function getNextOngoingTransitionDelay(exams = [], now = Date.now()) {
  const times = exams.flatMap((exam) => [exam.startsAt, exam.deadline])
    .map((value) => value ? new Date(value).getTime() : null)
    .filter((time) => Number.isFinite(time) && time > now)
    .sort((a, b) => a - b);
  if (!times.length) return null;
  return Math.max(1000, times[0] - now);
}

export function shouldPlayViolationSound(lastPlayedAt, now = Date.now(), cooldownMs = VIOLATION_SOUND_COOLDOWN_MS) {
  return !lastPlayedAt || now - lastPlayedAt >= cooldownMs;
}
