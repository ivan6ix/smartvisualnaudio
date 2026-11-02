// Violation Analytics filters shared by the dean dashboard and the exam integrity pages: search, date range,
// course, exam, violation type and severity. Rows carry display labels (course, exam, violationType, severity)
// and a timestamp in milliseconds.

export const VIOLATION_DATE_RANGES = ["All Time", "Today", "Last 7 Days", "Last 30 Days"];
export const ALL_FILTERS = {
  search: "",
  dateRange: "All Time",
  course: "All Courses",
  exam: "All Exams",
  type: "All Violations",
  severity: "All Severities",
};

export function getRangeStart(range, now = new Date()) {
  if (range === "Today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === "Last 7 Days") return now.getTime() - 7 * 24 * 60 * 60 * 1000;
  if (range === "Last 30 Days") return now.getTime() - 30 * 24 * 60 * 60 * 1000;
  return 0;
}

export function filterViolations(rows, filters, now = new Date()) {
  const term = (filters.search || "").trim().toLowerCase();
  const rangeStart = getRangeStart(filters.dateRange, now);
  return rows.filter((row) => (
    (!rangeStart || row.timestamp >= rangeStart)
    && (filters.course === ALL_FILTERS.course || row.course === filters.course)
    && (filters.exam === ALL_FILTERS.exam || row.exam === filters.exam)
    && (filters.type === ALL_FILTERS.type || row.violationType === filters.type)
    && (filters.severity === ALL_FILTERS.severity || row.severity === filters.severity)
    && (!term || [row.student, row.studentNumber, row.course, row.exam, row.violationType, row.description].join(" ").toLowerCase().includes(term))
  ));
}

// Options come from the loaded rows; the exam list follows the chosen course.
export function violationFilterOptions(rows, course = ALL_FILTERS.course) {
  const unique = (values) => [...new Set(values.filter((value) => value && value !== "-" && value !== "Unknown exam"))];
  return {
    courses: unique(rows.map((row) => row.course)),
    exams: unique(rows.filter((row) => course === ALL_FILTERS.course || row.course === course).map((row) => row.exam)),
    types: unique(rows.map((row) => row.violationType)),
    severities: unique(rows.map((row) => row.severity)),
  };
}

// Bar chart data: how many filtered alerts of each type, most frequent first.
export function countByViolationType(rows) {
  const counts = new Map();
  rows.forEach((row) => counts.set(row.violationType, (counts.get(row.violationType) || 0) + 1));
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}
