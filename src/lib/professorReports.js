// Printable reports for a professor's own courses: a grade sheet, one exam's results, integrity alerts, one
// student's record, and a summary of every class. Pure functions over rows the Reports page loads, so the same
// numbers go to the screen, the printout and the CSV file. Each student's result on an exam is their final
// attempt, chosen the same way as on the Scores page: the best graded attempt, otherwise the latest one.
import { buildRiskQueue, latestSubmittedAttempts, violationLabel } from "./integrityRisk.js";
import { normalizePeriod, PERIOD_ORDER } from "./deanAnalytics.js";
import { predictStudents } from "./riskPrediction.js";

export const DEFAULT_PASSING_SCORE = 60;
export const ALL = "All";

export const REPORT_TYPES = [
  { id: "grade-sheet", label: "Grade sheet", hint: "Students by exams", icon: "table" },
  { id: "exam-results", label: "Exam results", hint: "One exam in detail", icon: "check" },
  { id: "integrity", label: "Integrity", hint: "Alerts and risk", icon: "shield" },
  { id: "student", label: "Student", hint: "One student's record", icon: "user" },
  { id: "course-summary", label: "Course summary", hint: "All your classes", icon: "book" },
];

export const DATE_RANGES = ["All time", "Last 7 days", "Last 30 days", "Last 90 days", "Custom range"];
export const PERIODS = [...PERIOD_ORDER, "Other"];
export const STATUSES = ["Submitted", "Needs grading", "In progress", "Reopened", "Not started", "Missing"];
export const SEVERITIES = ["High", "Medium", "Low"];

export const EMPTY_FILTERS = {
  course: ALL,
  section: ALL,
  period: ALL,
  type: ALL,
  dateRange: "All time",
  from: "",
  to: "",
  search: "",
  examId: "",
  studentId: "",
  status: ALL,
  alertType: ALL,
  severity: ALL,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_DAYS = { "Last 7 days": 7, "Last 30 days": 30, "Last 90 days": 90 };

function time(value) {
  // new Date(null) is 1970, so a missing date must stay missing.
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreOf(attempt) {
  const score = Number(attempt?.score);
  return attempt && attempt.score !== null && attempt.score !== undefined && Number.isFinite(score) ? score : null;
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function round(value, digits = 1) {
  return value === null || value === undefined ? null : Number(value.toFixed(digits));
}

function key(examId, studentId) {
  return `${examId}:${studentId}`;
}

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const rowKey = keyOf(row);
    const list = groups.get(rowKey);
    if (list) list.push(row);
    else groups.set(rowKey, [row]);
  }
  return groups;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right), undefined, { numeric: true }));
}

export function percentText(value) {
  return value === null || value === undefined ? "-" : `${round(value)}%`;
}

export function examTitle(exam) {
  return exam?.exam_title || exam?.title || "Untitled exam";
}

export function examType(exam) {
  return exam?.exam_type || "Exam";
}

export function passingScore(exam) {
  const value = Number(exam?.passing_score);
  return value > 0 ? value : DEFAULT_PASSING_SCORE;
}

// The day an exam counts for: its scheduled start, else its deadline, else when it was created.
export function examDate(exam) {
  return exam?.exam_settings?.startsAt || exam?.exam_settings?.deadline || exam?.created_at || null;
}

function deadlinePassed(exam, now) {
  const deadline = time(exam?.exam_settings?.deadline);
  return deadline !== null && deadline <= now;
}

export function inDateRange(value, filters, now = Date.now()) {
  if (!filters.dateRange || filters.dateRange === "All time") return true;
  const at = time(value);
  if (at === null) return false;
  if (filters.dateRange === "Custom range") {
    const from = filters.from ? time(`${filters.from}T00:00:00`) : null;
    const to = filters.to ? time(`${filters.to}T23:59:59.999`) : null;
    return (from === null || at >= from) && (to === null || at <= to);
  }
  const days = RANGE_DAYS[filters.dateRange];
  return days ? at >= now - days * DAY_MS : true;
}

export function courseLabel(course) {
  return course ? `${course.course_code || course.course_name || "Course"} - ${course.section || "No section"}` : "-";
}

function studentName(student) {
  return student?.full_name || student?.email || "Unknown student";
}

function matchesSearch(text, search) {
  const needle = String(search || "").trim().toLowerCase();
  return !needle || String(text || "").toLowerCase().includes(needle);
}

// Indexes the loaded rows once. `now` is passed in so the same data always gives the same report in checks.
export function buildReportContext(data, now = Date.now()) {
  const courses = data.courses || [];
  const exams = data.exams || [];
  const attempts = data.attempts || [];
  const pending = new Set(data.pendingAttemptIds || []);
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const examById = new Map(exams.map((exam) => [exam.id, exam]));
  const studentById = new Map((data.students || []).map((student) => [student.id, student]));
  const enrollmentsByCourse = groupBy(data.enrollments || [], (row) => row.course_id);
  const assignmentsByExam = groupBy(data.assignments || [], (row) => row.exam_id);
  const exceptionsByExam = groupBy(data.exceptions || [], (row) => row.exam_id);
  const attemptsByKey = groupBy(attempts, (attempt) => key(attempt.exam_id, attempt.student_id));
  const attemptsByExam = groupBy(attempts, (attempt) => attempt.exam_id);
  const started = new Set((data.starts || []).map((row) => key(row.exam_id, row.student_id)));
  const violations = (data.violations || []).filter((item) => examById.has(item.exam_id));
  const violationsByKey = groupBy(violations, (item) => key(item.exam_id, item.student_id));

  // Who should take each exam: the selected students, or everyone enrolled in its course, plus anyone given
  // special access or with an attempt on record.
  const populationByExam = new Map();
  for (const exam of exams) {
    const ids = new Set(exam.assignment_mode === "selected_students"
      ? (assignmentsByExam.get(exam.id) || []).map((row) => row.student_id)
      : (enrollmentsByCourse.get(exam.course_id) || []).map((row) => row.student_id));
    (exceptionsByExam.get(exam.id) || []).forEach((row) => ids.add(row.student_id));
    (attemptsByExam.get(exam.id) || []).forEach((attempt) => ids.add(attempt.student_id));
    populationByExam.set(exam.id, [...ids]);
  }

  // Integrity risk per exam and student, from final submitted attempts and every alert.
  const durationByExam = Object.fromEntries(exams.map((exam) => [exam.id, Number(exam.duration || exam.time_limit) || null]));
  const riskByKey = new Map(buildRiskQueue({ attempts: latestSubmittedAttempts(attempts), violations, durationByExam }).map((row) => [row.key, row]));

  return { now, courses, exams, attempts, violations, pending, courseById, examById, studentById, enrollmentsByCourse, populationByExam, attemptsByKey, started, violationsByKey, riskByKey };
}

// One student's result on one exam.
export function studentResult(context, exam, studentId) {
  const attempts = [...(context.attemptsByKey.get(key(exam.id, studentId)) || [])]
    .sort((left, right) => (time(left.submitted_at || left.started_at) || 0) - (time(right.submitted_at || right.started_at) || 0));
  const graded = attempts.filter((attempt) => attempt.status !== "Reopened" && !context.pending.has(attempt.id) && scoreOf(attempt) !== null);
  const attempt = graded.length ? graded.reduce((best, item) => (scoreOf(item) > scoreOf(best) ? item : best), graded[0]) : attempts[attempts.length - 1] || null;
  let status;
  if (graded.length) status = "Submitted";
  else if (attempts.some((item) => context.pending.has(item.id))) status = "Needs grading";
  else if (attempts.some((item) => item.status === "Reopened")) status = "Reopened";
  else if (attempts.length || context.started.has(key(exam.id, studentId))) status = "In progress";
  else status = deadlinePassed(exam, context.now) ? "Missing" : "Not started";
  const score = status === "Submitted" ? scoreOf(attempt) : null;
  const started = time(attempt?.started_at);
  const submitted = time(attempt?.submitted_at);
  const risk = context.riskByKey.get(key(exam.id, studentId));
  return {
    status,
    attempt,
    score,
    earned: status === "Submitted" && attempt?.earned_points !== null && attempt?.earned_points !== undefined ? Number(attempt.earned_points) : null,
    max: attempt?.max_points !== null && attempt?.max_points !== undefined ? Number(attempt.max_points) : null,
    passed: score === null ? null : score >= passingScore(exam),
    submittedAt: status === "Submitted" || status === "Needs grading" ? attempt?.submitted_at || null : null,
    minutes: started !== null && submitted !== null && submitted > started ? Math.round((submitted - started) / 60000) : null,
    alerts: (context.violationsByKey.get(key(exam.id, studentId)) || []).length,
    riskLevel: risk ? risk.level : "-",
    riskScore: risk ? risk.score : 0,
  };
}

// Filter choices, each list following the filters above it.
export function filterOptions(context, filters) {
  const courseCodes = uniqueSorted(context.courses.map((course) => course.course_code));
  const sections = uniqueSorted(context.courses.filter((course) => filters.course === ALL || course.course_code === filters.course).map((course) => course.section));
  const exams = filterExams(context, { ...filters, examId: "" });
  const studentIds = new Set(exams.flatMap((exam) => context.populationByExam.get(exam.id) || []));
  const students = [...studentIds]
    .map((id) => context.studentById.get(id) || { id })
    .sort((left, right) => studentName(left).localeCompare(studentName(right)));
  const types = uniqueSorted(context.exams.map(examType));
  const alertTypes = uniqueSorted(context.violations.map((item) => violationLabel(item.violation_type)));
  return { courseCodes, sections, exams, students, types, alertTypes };
}

export function filterCourses(context, filters) {
  return context.courses.filter((course) => (filters.course === ALL || course.course_code === filters.course)
    && (filters.section === ALL || course.section === filters.section));
}

export function filterExams(context, filters) {
  const courseIds = new Set(filterCourses(context, filters).map((course) => course.id));
  return context.exams
    .filter((exam) => courseIds.has(exam.course_id)
      && (filters.period === ALL || normalizePeriod(exam.description) === filters.period)
      && (filters.type === ALL || examType(exam) === filters.type)
      && inDateRange(examDate(exam), filters, context.now))
    .sort((left, right) => (time(examDate(left)) || 0) - (time(examDate(right)) || 0) || examTitle(left).localeCompare(examTitle(right)));
}

function studentFields(context, studentId, course) {
  const student = context.studentById.get(studentId) || {};
  return { studentId, student: studentName(student), studentNumber: student.student_number || "-", section: course ? courseLabel(course) : "-" };
}

// Students down the side, one column per exam. Exams with the same type and title in different sections share a
// column, so a course taught in several sections prints as one sheet.
export function buildGradeSheet(context, filters) {
  if (filters.course === ALL) return { needs: "Choose a course to build its grade sheet.", columns: [], rows: [], summary: [] };
  const exams = filterExams(context, filters);
  const columnKey = (exam) => `${examType(exam)}|${examTitle(exam).trim().toLowerCase()}`;
  const columns = [];
  const columnByKey = new Map();
  for (const exam of exams) {
    const columnId = columnKey(exam);
    if (!columnByKey.has(columnId)) {
      const column = { key: `exam:${columnId}`, label: examTitle(exam), type: examType(exam) };
      columnByKey.set(columnId, column);
      columns.push(column);
    }
  }
  const studentCourse = new Map();
  for (const course of filterCourses(context, filters)) {
    (context.enrollmentsByCourse.get(course.id) || []).forEach((row) => studentCourse.set(row.student_id, course));
  }
  for (const exam of exams) {
    (context.populationByExam.get(exam.id) || []).forEach((studentId) => {
      if (!studentCourse.has(studentId)) studentCourse.set(studentId, context.courseById.get(exam.course_id));
    });
  }
  const examsByStudentColumn = new Map();
  for (const exam of exams) {
    for (const studentId of context.populationByExam.get(exam.id) || []) {
      examsByStudentColumn.set(`${studentId}|${columnKey(exam)}`, exam);
    }
  }

  let missingWork = 0;
  const rows = [...studentCourse.entries()].map(([studentId, course]) => {
    const row = { id: studentId, ...studentFields(context, studentId, course) };
    const scores = [];
    const passMarks = [];
    let incomplete = false;
    for (const [columnId, column] of columnByKey) {
      const exam = examsByStudentColumn.get(`${studentId}|${columnId}`);
      if (!exam) {
        row[column.key] = "-";
        continue;
      }
      const result = studentResult(context, exam, studentId);
      passMarks.push(passingScore(exam));
      if (result.score !== null) {
        scores.push(result.score);
        row[column.key] = percentText(result.score);
      } else {
        incomplete = true;
        if (result.status === "Missing") missingWork += 1;
        row[column.key] = result.status;
      }
    }
    const studentAverage = average(scores);
    row.averageValue = studentAverage;
    row.average = percentText(studentAverage);
    if (!passMarks.length) row.remark = "No exams";
    else if (incomplete) row.remark = "Incomplete";
    else row.remark = studentAverage >= average(passMarks) ? "Passed" : "Failed";
    return row;
  })
    .filter((row) => matchesSearch(`${row.student} ${row.studentNumber}`, filters.search))
    .sort((left, right) => left.section.localeCompare(right.section) || left.student.localeCompare(right.student));

  const classAverage = average(rows.map((row) => row.averageValue).filter((value) => value !== null));
  return {
    columns: [
      { key: "student", label: "Student" },
      { key: "studentNumber", label: "Student number" },
      { key: "section", label: "Section" },
      ...columns,
      { key: "average", label: "Average" },
      { key: "remark", label: "Remarks" },
    ],
    rows,
    summary: [
      { label: "Students", value: rows.length },
      { label: "Class average", value: percentText(classAverage) },
      { label: "Passed", value: `${rows.filter((row) => row.remark === "Passed").length} of ${rows.length}` },
      { label: "Missing work", value: missingWork },
    ],
  };
}

// Everyone who should take one exam, with their result, time taken, alerts and integrity risk.
export function buildExamResults(context, filters) {
  const exam = context.examById.get(filters.examId);
  if (!exam || !filterExams(context, { ...filters, examId: "" }).some((item) => item.id === exam.id)) {
    return { needs: "Choose an exam to see its results.", columns: [], rows: [], summary: [] };
  }
  const course = context.courseById.get(exam.course_id);
  const all = (context.populationByExam.get(exam.id) || []).map((studentId) => {
    const result = studentResult(context, exam, studentId);
    return {
      id: studentId,
      ...studentFields(context, studentId, course),
      status: result.status,
      points: result.earned !== null && result.max ? `${round(result.earned, 2)} / ${round(result.max, 2)}` : "-",
      scoreValue: result.score,
      score: percentText(result.score),
      submitted: result.submittedAt,
      minutes: result.minutes === null ? "-" : `${result.minutes} min`,
      alerts: result.alerts,
      risk: result.riskLevel,
      remark: result.passed === null ? "-" : result.passed ? "Passed" : "Failed",
    };
  });
  const rows = all
    .filter((row) => (filters.status === ALL || row.status === filters.status) && matchesSearch(`${row.student} ${row.studentNumber}`, filters.search))
    .sort((left, right) => left.student.localeCompare(right.student));
  const scored = all.map((row) => row.scoreValue).filter((value) => value !== null);
  const passed = all.filter((row) => row.remark === "Passed").length;
  return {
    title: `${examTitle(exam)} (${courseLabel(course)})`,
    columns: [
      { key: "student", label: "Student" },
      { key: "studentNumber", label: "Student number" },
      { key: "status", label: "Status" },
      { key: "points", label: "Points" },
      { key: "score", label: "Score" },
      { key: "remark", label: "Remarks" },
      { key: "submitted", label: "Submitted", format: "datetime" },
      { key: "minutes", label: "Time taken" },
      { key: "alerts", label: "Alerts" },
      { key: "risk", label: "Risk" },
    ],
    rows,
    summary: [
      { label: "Submitted", value: `${scored.length} of ${all.length}` },
      { label: "Average", value: percentText(average(scored)) },
      { label: "Highest / lowest", value: scored.length ? `${round(Math.max(...scored))}% / ${round(Math.min(...scored))}%` : "-" },
      { label: "Pass rate", value: scored.length ? `${Math.round((passed / scored.length) * 100)}%` : "-" },
    ],
  };
}

// Every monitoring alert in the chosen exams and dates, with the risk level of that student's attempt.
export function buildIntegrityReport(context, filters) {
  const exams = filterExams(context, { ...filters, dateRange: "All time" });
  const examIds = new Set(filters.examId ? [filters.examId] : exams.map((exam) => exam.id));
  const rows = context.violations
    .filter((item) => examIds.has(item.exam_id) && inDateRange(item.created_at, filters, context.now)
      && (filters.alertType === ALL || violationLabel(item.violation_type) === filters.alertType)
      && (filters.severity === ALL || String(item.severity || "").toLowerCase() === filters.severity.toLowerCase()))
    .map((item) => {
      const exam = context.examById.get(item.exam_id);
      const course = context.courseById.get(exam?.course_id);
      const risk = context.riskByKey.get(key(item.exam_id, item.student_id));
      return {
        id: item.id || `${item.exam_id}:${item.student_id}:${item.created_at}`,
        ...studentFields(context, item.student_id, course),
        exam: examTitle(exam),
        alert: violationLabel(item.violation_type),
        severity: item.severity || "-",
        at: item.created_at,
        risk: risk ? risk.level : "-",
      };
    })
    .filter((row) => matchesSearch(`${row.student} ${row.studentNumber} ${row.exam} ${row.alert}`, filters.search))
    .sort((left, right) => (time(right.at) || 0) - (time(left.at) || 0));
  const byType = groupBy(rows, (row) => row.alert);
  const top = [...byType.entries()].sort((left, right) => right[1].length - left[1].length)[0];
  const flagged = new Set(rows.map((row) => `${row.studentId}`));
  const highRisk = new Set(rows.filter((row) => row.risk === "High").map((row) => `${row.studentId}:${row.exam}`));
  return {
    columns: [
      { key: "student", label: "Student" },
      { key: "studentNumber", label: "Student number" },
      { key: "section", label: "Section" },
      { key: "exam", label: "Exam" },
      { key: "alert", label: "Alert" },
      { key: "severity", label: "Severity" },
      { key: "at", label: "Date and time", format: "datetime" },
      { key: "risk", label: "Attempt risk" },
    ],
    rows,
    summary: [
      { label: "Alerts", value: rows.length },
      { label: "Students flagged", value: flagged.size },
      { label: "High-risk attempts", value: highRisk.size },
      { label: "Most common", value: top ? `${top[0]} (${top[1].length})` : "-" },
    ],
  };
}

// One student's exams across the professor's courses, with their trend and at-risk prediction.
export function buildStudentReport(context, filters) {
  const studentId = filters.studentId;
  if (!studentId) return { needs: "Choose a student to see their record.", columns: [], rows: [], summary: [] };
  const exams = filterExams(context, filters).filter((exam) => (context.populationByExam.get(exam.id) || []).includes(studentId));
  const rows = exams.map((exam) => {
    const course = context.courseById.get(exam.course_id);
    const result = studentResult(context, exam, studentId);
    return {
      id: exam.id,
      section: courseLabel(course),
      exam: examTitle(exam),
      type: examType(exam),
      period: normalizePeriod(exam.description),
      status: result.status,
      scoreValue: result.score,
      score: percentText(result.score),
      remark: result.passed === null ? "-" : result.passed ? "Passed" : "Failed",
      submitted: result.submittedAt,
      alerts: result.alerts,
      risk: result.riskLevel,
    };
  });
  const scored = rows.map((row) => row.scoreValue).filter((value) => value !== null);
  const finalAttempts = exams.map((exam) => studentResult(context, exam, studentId)).filter((result) => result.score !== null).map((result) => result.attempt);
  const predictions = predictStudents({ exams, courses: context.courses, attempts: finalAttempts });
  const worst = predictions[0];
  const student = context.studentById.get(studentId) || {};
  return {
    title: `${studentName(student)} (${student.student_number || "no student number"})`,
    columns: [
      { key: "section", label: "Course" },
      { key: "exam", label: "Exam" },
      { key: "type", label: "Type" },
      { key: "period", label: "Period" },
      { key: "status", label: "Status" },
      { key: "score", label: "Score" },
      { key: "remark", label: "Remarks" },
      { key: "submitted", label: "Submitted", format: "datetime" },
      { key: "alerts", label: "Alerts" },
      { key: "risk", label: "Risk" },
    ],
    rows,
    summary: [
      { label: "Average", value: percentText(average(scored)) },
      { label: "Passed", value: `${rows.filter((row) => row.remark === "Passed").length} of ${rows.length}` },
      { label: "Alerts", value: rows.reduce((total, row) => total + row.alerts, 0) },
      { label: "Next exam outlook", value: worst ? `${worst.level} risk (${round(worst.predicted)}% predicted)` : "Not enough scores" },
    ],
  };
}

// One row per class: students, exams, average, pass rate, missing work, alerts and students at risk.
export function buildCourseSummary(context, filters) {
  const exams = filterExams(context, filters);
  const examsByCourse = groupBy(exams, (exam) => exam.course_id);
  const rows = filterCourses(context, filters).map((course) => {
    const courseExams = examsByCourse.get(course.id) || [];
    const results = courseExams.flatMap((exam) => (context.populationByExam.get(exam.id) || []).map((studentId) => ({ exam, studentId, ...studentResult(context, exam, studentId) })));
    const scored = results.filter((result) => result.score !== null);
    const passed = scored.filter((result) => result.passed).length;
    const atRisk = predictStudents({ exams: courseExams, courses: [course], attempts: scored.map((result) => result.attempt) }).filter((row) => row.level === "High").length;
    return {
      id: course.id,
      section: courseLabel(course),
      courseName: course.course_name || "-",
      students: (context.enrollmentsByCourse.get(course.id) || []).length,
      exams: courseExams.length,
      averageValue: average(scored.map((result) => result.score)),
      average: percentText(average(scored.map((result) => result.score))),
      passRate: scored.length ? `${Math.round((passed / scored.length) * 100)}%` : "-",
      missing: results.filter((result) => result.status === "Missing").length,
      alerts: results.reduce((total, result) => total + result.alerts, 0),
      atRisk,
    };
  })
    .filter((row) => matchesSearch(`${row.section} ${row.courseName}`, filters.search))
    .sort((left, right) => left.section.localeCompare(right.section));
  const overall = average(rows.map((row) => row.averageValue).filter((value) => value !== null));
  return {
    columns: [
      { key: "section", label: "Course and section" },
      { key: "courseName", label: "Course name" },
      { key: "students", label: "Students" },
      { key: "exams", label: "Exams" },
      { key: "average", label: "Average" },
      { key: "passRate", label: "Pass rate" },
      { key: "missing", label: "Missing work" },
      { key: "alerts", label: "Alerts" },
      { key: "atRisk", label: "At risk" },
    ],
    rows,
    summary: [
      { label: "Classes", value: rows.length },
      { label: "Students", value: rows.reduce((total, row) => total + row.students, 0) },
      { label: "Overall average", value: percentText(overall) },
      { label: "Students at risk", value: rows.reduce((total, row) => total + row.atRisk, 0) },
    ],
  };
}

const BUILDERS = {
  "grade-sheet": buildGradeSheet,
  "exam-results": buildExamResults,
  integrity: buildIntegrityReport,
  student: buildStudentReport,
  "course-summary": buildCourseSummary,
};

export function buildReport(context, reportType, filters) {
  const report = (BUILDERS[reportType] || buildGradeSheet)(context, { ...EMPTY_FILTERS, ...filters });
  return { title: "", needs: "", ...report };
}

export function formatCell(column, value) {
  if (column.format === "datetime") {
    const at = time(value);
    return at === null ? "-" : new Date(at).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

// Spreadsheet apps run cells that start with these characters as formulas, so they get a leading quote.
function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reportCsv({ columns, rows }) {
  const lines = [columns.map((column) => csvCell(column.label)).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvCell(formatCell(column, row[column.key]))).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function reportFileName(reportType, now = new Date()) {
  const label = REPORT_TYPES.find((item) => item.id === reportType)?.label || "Report";
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return `${label.toLowerCase().replace(/\s+/g, "-")}-${date}.csv`;
}

// The filters a printed report lists under its title (only the ones in use).
export function describeFilters(reportType, filters, context) {
  const parts = [];
  if (filters.course !== ALL) parts.push(["Course", filters.course]);
  if (filters.section !== ALL) parts.push(["Section", filters.section]);
  if (filters.period !== ALL) parts.push(["Period", filters.period]);
  if (filters.type !== ALL) parts.push(["Type", filters.type]);
  if (filters.dateRange === "Custom range") parts.push(["Dates", `${filters.from || "start"} to ${filters.to || "today"}`]);
  else if (filters.dateRange !== "All time") parts.push(["Dates", filters.dateRange]);
  if (["exam-results", "integrity"].includes(reportType) && filters.examId) parts.push(["Exam", examTitle(context.examById.get(filters.examId))]);
  if (reportType === "exam-results" && filters.status !== ALL) parts.push(["Status", filters.status]);
  if (reportType === "integrity" && filters.alertType !== ALL) parts.push(["Alert", filters.alertType]);
  if (reportType === "integrity" && filters.severity !== ALL) parts.push(["Severity", filters.severity]);
  if (filters.search.trim()) parts.push(["Search", filters.search.trim()]);
  return parts;
}
