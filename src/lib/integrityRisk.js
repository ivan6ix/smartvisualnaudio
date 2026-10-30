// Integrity risk score for exam attempts. Each rule adds a fixed number of points per recorded event up to a
// cap, and the total is capped at 100. The score only orders attempts for a person to review; it never
// decides anything on its own.

export const RISK_RULES = [
  { id: "device", label: "Phone or gadget", types: ["PHONE_DETECTED", "GADGET_DETECTED"], points: 25, cap: 40 },
  { id: "faces", label: "Multiple faces", types: ["MULTIPLE_FACE"], points: 20, cap: 40 },
  { id: "attention", label: "No face or looking away", types: ["NO_FACE", "LOOKING_AWAY"], points: 4, cap: 24 },
  { id: "browser", label: "Tab switch, copy or fullscreen exit", types: ["TAB_SWITCH", "COPY_ATTEMPT", "FULLSCREEN_EXIT"], points: 5, cap: 25 },
  { id: "audio", label: "Background voice or noise", types: ["BACKGROUND_VOICE", "LOUD_NOISE_DETECTED", "AUDIO_DETECTED", "LOUD_AUDIO"], points: 4, cap: 16 },
  { id: "microphone", label: "Microphone lost", types: ["MICROPHONE_UNAVAILABLE", "MICROPHONE_DISCONNECTED", "MICROPHONE_MUTED", "MICROPHONE_ACCESS_LOST"], points: 3, cap: 12 },
];

// Finishing in under a quarter of the allowed time with a score far above the class average.
export const FAST_HIGH_SCORE = { label: "Very fast with a much higher score", points: 15, timeShare: 0.25, scoreGap: 20 };
export const MEDIUM_RISK_FROM = 30;
export const HIGH_RISK_FROM = 60;
export const TIMELINE_PARTS = 6;
const SUBMIT_GRACE_MS = 60000;

const LABELS = {
  MULTIPLE_FACE: "Multiple faces",
  NO_FACE: "No face",
  LOOKING_AWAY: "Looking away",
  BACKGROUND_VOICE: "Background voice",
  LOUD_NOISE_DETECTED: "Loud noise",
  AUDIO_DETECTED: "Background audio",
  LOUD_AUDIO: "Loud audio",
  TAB_SWITCH: "Tab switch",
  COPY_ATTEMPT: "Copy attempt",
  FULLSCREEN_EXIT: "Fullscreen exit",
  PHONE_DETECTED: "Cellphone detected",
  GADGET_DETECTED: "Spare gadget detected",
  MICROPHONE_UNAVAILABLE: "Microphone unavailable",
  MICROPHONE_DISCONNECTED: "Microphone disconnected",
  MICROPHONE_MUTED: "Microphone muted",
  MICROPHONE_ACCESS_LOST: "Microphone access lost",
};

export function violationLabel(type) {
  return LABELS[type] || "Other alert";
}

export function riskLevel(score) {
  if (score >= HIGH_RISK_FROM) return "High";
  if (score >= MEDIUM_RISK_FROM) return "Medium";
  return "Low";
}

function time(value) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function attemptMinutes(attempt) {
  const started = time(attempt?.started_at);
  const submitted = time(attempt?.submitted_at);
  return started !== null && submitted !== null && submitted > started ? (submitted - started) / 60000 : null;
}

function numericScore(attempt) {
  const score = Number(attempt?.score);
  return attempt?.score !== null && attempt?.score !== undefined && Number.isFinite(score) ? score : null;
}

export function scoreRisk({ violations, attempt, durationMinutes, classMean }) {
  const reasons = [];
  for (const rule of RISK_RULES) {
    const count = violations.filter((item) => rule.types.includes(item.violation_type)).length;
    if (count) reasons.push({ label: rule.label, count, points: Math.min(rule.cap, count * rule.points) });
  }
  const minutes = attemptMinutes(attempt);
  const score = numericScore(attempt);
  if (minutes !== null && score !== null && durationMinutes > 0 && classMean !== null && classMean !== undefined
    && minutes < durationMinutes * FAST_HIGH_SCORE.timeShare && score >= classMean + FAST_HIGH_SCORE.scoreGap) {
    reasons.push({ label: FAST_HIGH_SCORE.label, count: 1, points: FAST_HIGH_SCORE.points });
  }
  reasons.sort((left, right) => right.points - left.points);
  const total = Math.min(100, reasons.reduce((sum, reason) => sum + reason.points, 0));
  return { score: total, level: riskLevel(total), reasons };
}

function key(examId, studentId) {
  return `${examId}:${studentId}`;
}

// One row per exam and student: their submitted attempt (if any) and every alert they triggered in that exam.
export function buildRiskQueue({ attempts, violations, durationByExam = {} }) {
  const meanByExam = new Map();
  for (const attempt of attempts) {
    const score = numericScore(attempt);
    if (score === null) continue;
    const entry = meanByExam.get(attempt.exam_id) || { total: 0, count: 0 };
    entry.total += score;
    entry.count += 1;
    meanByExam.set(attempt.exam_id, entry);
  }
  const rows = new Map();
  for (const attempt of attempts) {
    rows.set(key(attempt.exam_id, attempt.student_id), { examId: attempt.exam_id, studentId: attempt.student_id, attempt, violations: [] });
  }
  for (const item of violations) {
    const rowKey = key(item.exam_id, item.student_id);
    if (!rows.has(rowKey)) rows.set(rowKey, { examId: item.exam_id, studentId: item.student_id, attempt: null, violations: [] });
    rows.get(rowKey).violations.push(item);
  }
  return [...rows.values()]
    .map((row) => {
      const mean = meanByExam.get(row.examId);
      const risk = scoreRisk({
        violations: row.violations,
        attempt: row.attempt,
        durationMinutes: durationByExam[row.examId] || null,
        classMean: mean ? mean.total / mean.count : null,
      });
      return { ...row, ...risk, key: key(row.examId, row.studentId), violationCount: row.violations.length };
    })
    .sort((left, right) => right.score - left.score || right.violationCount - left.violationCount || String(left.key).localeCompare(String(right.key)));
}

// Places each alert within its attempt: by minutes of the allowed time when one exam is shown, otherwise by
// the share of that attempt's own duration so different exams can be combined.
function timeline(violations, attempts, durationMinutes) {
  const byStudent = new Map(attempts.map((attempt) => [key(attempt.exam_id, attempt.student_id), attempt]));
  const width = durationMinutes > 0 ? durationMinutes / TIMELINE_PARTS : null;
  const buckets = Array.from({ length: TIMELINE_PARTS }, (_, index) => ({
    label: width
      ? `${Math.round(index * width)}–${Math.round((index + 1) * width)}`
      : `${Math.round((index * 100) / TIMELINE_PARTS)}–${Math.round(((index + 1) * 100) / TIMELINE_PARTS)}%`,
    count: 0,
  }));
  for (const item of violations) {
    const attempt = byStudent.get(key(item.exam_id, item.student_id));
    const started = time(attempt?.started_at);
    const submitted = time(attempt?.submitted_at);
    const at = time(item.created_at);
    if (started === null || submitted === null || at === null || at < started || at > submitted + SUBMIT_GRACE_MS) continue;
    const share = width ? (at - started) / 60000 / durationMinutes : (at - started) / Math.max(1, submitted - started);
    buckets[Math.min(TIMELINE_PARTS - 1, Math.max(0, Math.floor(share * TIMELINE_PARTS)))].count += 1;
  }
  return buckets;
}

export function summarizeIntegrity({ queue, violations, attempts, durationMinutes = null }) {
  const counts = new Map();
  for (const item of violations) {
    const label = violationLabel(item.violation_type);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  const flagged = new Set(violations.map((item) => key(item.exam_id, item.student_id)));
  return {
    attemptCount: attempts.length,
    high: queue.filter((row) => row.level === "High").length,
    medium: queue.filter((row) => row.level === "Medium").length,
    low: queue.filter((row) => row.level === "Low").length,
    violationCount: violations.length,
    violationsPerAttempt: attempts.length ? violations.length / attempts.length : null,
    cleanAttempts: attempts.filter((attempt) => !flagged.has(key(attempt.exam_id, attempt.student_id))).length,
    byType: [...counts].map(([label, count]) => ({ label, count })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    timeline: timeline(violations, attempts, durationMinutes),
    timelineUnit: durationMinutes > 0 ? "minutes" : "percent",
  };
}
