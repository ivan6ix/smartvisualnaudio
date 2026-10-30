// College-wide exam analytics for the dean: totals, trends across academic periods, a comparison of sections,
// and rule-based recommendations. Uses each student's latest submitted attempt on published exams.
import { HIGH_RISK_FROM, buildRiskQueue, latestSubmittedAttempts } from "./integrityRisk.js";

export const PERIOD_ORDER = ["Prelim", "Midterm", "Semi-Final", "Final"];
export const OTHER_PERIOD = "Other";
export const DEFAULT_PASSING_SCORE = 60;
// A section is flagged when its pass rate is this far below the overall rate, or its share of high-risk
// attempts is more than this multiple of the overall share.
export const LOW_PASS_GAP = 0.1;
export const HIGH_RISK_MULTIPLE = 2;
export const SCORE_DROP_POINTS = 5;

export function normalizePeriod(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  return PERIOD_ORDER.find((period) => period.toLowerCase().replace(/-/g, "") === text) || OTHER_PERIOD;
}

function scoreOf(attempt) {
  const score = Number(attempt.score);
  return attempt.score !== null && attempt.score !== undefined && Number.isFinite(score) ? score : null;
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right)));
}

// Shared measures for any group of exams: attempts, scores, pass rate, alerts and high-risk attempts.
function measure(examIds, context) {
  const ids = new Set(examIds);
  const attempts = context.attempts.filter((attempt) => ids.has(attempt.exam_id));
  const scored = attempts.filter((attempt) => scoreOf(attempt) !== null);
  const passed = scored.filter((attempt) => scoreOf(attempt) >= context.passingByExam.get(attempt.exam_id));
  const alerts = context.violations.filter((item) => ids.has(item.exam_id)).length;
  const highRisk = context.risk.filter((row) => ids.has(row.examId) && row.attempt && row.score >= HIGH_RISK_FROM).length;
  return {
    exams: ids.size,
    attempts: attempts.length,
    averageScore: average(scored.map(scoreOf)),
    passRate: scored.length ? passed.length / scored.length : null,
    alerts,
    alertsPer100: attempts.length ? (alerts / attempts.length) * 100 : null,
    alertsPerAttempt: attempts.length ? alerts / attempts.length : null,
    highRisk,
    highRiskRate: attempts.length ? highRisk / attempts.length : null,
  };
}

function percentText(value) {
  return `${Math.round(value * 100)}%`;
}

function recommendationsFor(kpis, periods, sections) {
  const list = [];
  for (const section of sections) {
    if (section.flags.lowPass) list.push({
      tag: "Students",
      title: `Schedule a review session for ${section.label}`,
      detail: `Pass rate is ${percentText(section.passRate)}, against ${percentText(kpis.passRate)} overall.`,
    });
  }
  for (const section of sections) {
    if (section.flags.highRisk) list.push({
      tag: "Integrity",
      title: `Require environment scans in ${section.label}`,
      detail: `${percentText(section.highRiskRate)} of its attempts are high risk, against ${percentText(kpis.highRiskRate)} overall.`,
    });
  }
  const overall = scoreDrop(periods);
  if (overall) list.push({
    tag: "Trend",
    title: `Average score fell from ${overall.from} to ${overall.to}`,
    detail: `From ${overall.fromScore.toFixed(1)}% to ${overall.toScore.toFixed(1)}%. Check whether the ${overall.to} exams were harder or the topics need review.`,
  });
  for (const section of sections) {
    if (section.trend) list.push({
      tag: "Trend",
      title: `Scores in ${section.label} fell from ${section.trend.from} to ${section.trend.to}`,
      detail: `From ${section.trend.fromScore.toFixed(1)}% to ${section.trend.toScore.toFixed(1)}%. Review the ${section.trend.to} topics with this section.`,
    });
  }
  return list;
}

// A drop of at least SCORE_DROP_POINTS between the last two standard periods that have scores.
function scoreDrop(periods) {
  const standard = periods.filter((row) => row.period !== OTHER_PERIOD && row.averageScore !== null);
  if (standard.length < 2) return null;
  const [previous, latest] = standard.slice(-2);
  return previous.averageScore - latest.averageScore >= SCORE_DROP_POINTS
    ? { from: previous.period, to: latest.period, fromScore: previous.averageScore, toScore: latest.averageScore }
    : null;
}

function periodRows(scopedExams, context) {
  return [...PERIOD_ORDER, OTHER_PERIOD]
    .map((period) => ({ period, examIds: scopedExams.filter((exam) => normalizePeriod(exam.description) === period).map((exam) => exam.id) }))
    .filter((row) => row.examIds.length)
    .map(({ period, examIds }) => ({ period, ...measure(examIds, context) }));
}

export function buildDeanAnalytics({ exams, courses, attempts, violations, filters = {} }) {
  const options = {
    academicYears: uniqueSorted(courses.map((course) => course.academic_year)),
    semesters: uniqueSorted(courses.map((course) => course.semester)),
    programIds: uniqueSorted(courses.map((course) => course.program_id)),
  };
  const scopedCourses = courses.filter((course) => (!filters.academicYear || course.academic_year === filters.academicYear)
    && (!filters.semester || course.semester === filters.semester)
    && (!filters.programId || course.program_id === filters.programId));
  const courseById = new Map(scopedCourses.map((course) => [course.id, course]));
  const scopedExams = exams.filter((exam) => exam.status === "Published" && courseById.has(exam.course_id));
  const examIds = new Set(scopedExams.map((exam) => exam.id));
  const finalAttempts = latestSubmittedAttempts(attempts.filter((attempt) => examIds.has(attempt.exam_id)));
  const scopedViolations = violations.filter((item) => examIds.has(item.exam_id));
  const context = {
    attempts: finalAttempts,
    violations: scopedViolations,
    risk: buildRiskQueue({ attempts: finalAttempts, violations: scopedViolations }),
    passingByExam: new Map(scopedExams.map((exam) => [exam.id, Number(exam.passing_score) > 0 ? Number(exam.passing_score) : DEFAULT_PASSING_SCORE])),
  };

  const kpis = measure(examIds, context);
  const periods = periodRows(scopedExams, context);
  const sections = scopedCourses
    .map((course) => {
      const ids = scopedExams.filter((exam) => exam.course_id === course.id).map((exam) => exam.id);
      return { course, ids };
    })
    .filter((row) => row.ids.length)
    .map(({ course, ids }) => {
      const result = measure(ids, context);
      const courseExams = scopedExams.filter((exam) => exam.course_id === course.id);
      return {
        trend: scoreDrop(periodRows(courseExams, context)),
        id: course.id,
        label: `${course.course_code} - ${course.section}`,
        courseName: course.course_name || "",
        semester: course.semester || "",
        academicYear: course.academic_year || "",
        ...result,
        flags: {
          lowPass: result.passRate !== null && kpis.passRate !== null && result.passRate <= kpis.passRate - LOW_PASS_GAP,
          highRisk: result.highRisk > 0 && result.highRiskRate > (kpis.highRiskRate || 0) * HIGH_RISK_MULTIPLE,
        },
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));

  return { kpis, periods, sections, recommendations: recommendationsFor(kpis, periods, sections), options };
}
