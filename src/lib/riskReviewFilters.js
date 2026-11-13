import { summarizeIntegrity } from "./integrityRisk.js";

// The Risk review's own filters on the Exam Integrity page, separate from the Violation Analytics filters.
export const ALL_RISK_FILTERS = { search: "", course: "All Courses", exam: "All Exams", level: "All" };
export const RISK_LEVELS = ["All", "High", "Medium", "Low"];

const rowKey = (examId, studentId) => `${examId}|${studentId}`;

// Course and exam choices from the review rows; the exam list follows the chosen course.
export function riskFilterOptions(rows = [], course = ALL_RISK_FILTERS.course) {
  const courses = [...new Set(rows.map((row) => row.courseLabel).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const exams = new Map();
  for (const row of rows) {
    if (course !== ALL_RISK_FILTERS.course && row.courseLabel !== course) continue;
    if (row.examId && !exams.has(row.examId)) exams.set(row.examId, row.examTitle || "Unknown exam");
  }
  return {
    courses,
    exams: [...exams].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

// risk: { rows, violations, attempts } as loaded. Search, course and exam narrow everything in the panel
// (the counts, the queue and both charts); the risk level only narrows the queue.
export function filterRiskReview(risk, filters = ALL_RISK_FILTERS) {
  const rows = risk?.rows || [];
  const query = String(filters.search || "").trim().toLowerCase();
  const matches = rows.filter((row) => {
    if (filters.course && filters.course !== ALL_RISK_FILTERS.course && row.courseLabel !== filters.course) return false;
    if (filters.exam && filters.exam !== ALL_RISK_FILTERS.exam && row.examId !== filters.exam) return false;
    if (!query) return true;
    return `${row.studentName || ""} ${row.studentDetail || ""} ${row.examTitle || ""} ${row.courseLabel || ""}`.toLowerCase().includes(query);
  });
  const keys = new Set(matches.map((row) => rowKey(row.examId, row.studentId)));
  const violations = (risk?.violations || []).filter((item) => keys.has(rowKey(item.exam_id, item.student_id)));
  const attempts = (risk?.attempts || []).filter((item) => keys.has(rowKey(item.exam_id, item.student_id)));
  const level = RISK_LEVELS.includes(filters.level) ? filters.level : "All";
  return {
    rows: level === "All" ? matches : matches.filter((row) => row.level === level),
    summary: summarizeIntegrity({ queue: matches, violations, attempts }),
    total: rows.length,
  };
}
