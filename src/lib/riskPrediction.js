// Early warning for students likely to fail their next exam in a section. The prediction is the average of
// the last 3 scores plus a quarter of the score trend (least-squares slope per exam over the last 5), so it can
// be explained in one sentence. With only a few exams per student the full trend overreacts to one bad or good
// exam; in the backtest a quarter weight predicted better than the full trend. A backtest replays the rule on
// past exams to show how often it was right.

export const RECENT_SCORES = 3;
export const TREND_SCORES = 5;
export const TREND_WEIGHT = 0.25;
export const MEDIUM_MARGIN = 5;
export const FALLING_SLOPE = -3;
export const DEFAULT_PASSING_SCORE = 60;
const LEVEL_RANK = { High: 0, Medium: 1, Low: 2 };

export function trendSlope(scores) {
  if (scores.length < 2) return 0;
  const meanX = (scores.length - 1) / 2;
  const meanY = scores.reduce((total, value) => total + value, 0) / scores.length;
  let numerator = 0;
  let denominator = 0;
  scores.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  });
  return numerator / denominator;
}

export function predictNext(scores, passingScore = DEFAULT_PASSING_SCORE) {
  if (scores.length < 2) return null;
  const recent = scores.slice(-RECENT_SCORES);
  const slope = trendSlope(scores.slice(-TREND_SCORES));
  const average = recent.reduce((total, value) => total + value, 0) / recent.length;
  const predicted = Math.min(100, Math.max(0, average + TREND_WEIGHT * slope));
  const level = predicted < passingScore ? "High" : predicted < passingScore + MEDIUM_MARGIN ? "Medium" : "Low";
  const below = recent.filter((value) => value < passingScore).length;
  const reasons = [];
  if (slope <= FALLING_SLOPE) reasons.push(`Falling about ${Math.round(Math.abs(slope))} points per exam`);
  if (below) reasons.push(`Below passing in ${below} of the last ${recent.length} exams`);
  reasons.push(`Latest score ${Math.round(scores.at(-1))}%`);
  return { predicted, slope, level, reasons };
}

function scoreOf(attempt) {
  const score = Number(attempt.score);
  return attempt.score !== null && attempt.score !== undefined && Number.isFinite(score) ? score : null;
}

// One series per student and section from their final attempts, ordered by submission time.
export function predictStudents({ exams, courses, attempts }) {
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const examById = new Map(exams.map((exam) => [exam.id, exam]));
  const passingByCourse = new Map();
  for (const exam of exams) {
    const list = passingByCourse.get(exam.course_id) || [];
    list.push(Number(exam.passing_score) > 0 ? Number(exam.passing_score) : DEFAULT_PASSING_SCORE);
    passingByCourse.set(exam.course_id, list);
  }
  const series = new Map();
  for (const attempt of attempts) {
    const exam = examById.get(attempt.exam_id);
    const score = scoreOf(attempt);
    if (!exam || score === null) continue;
    const key = `${attempt.student_id}:${exam.course_id}`;
    const entry = series.get(key) || { studentId: attempt.student_id, courseId: exam.course_id, points: [] };
    entry.points.push({ score, at: new Date(attempt.submitted_at).getTime() || 0 });
    series.set(key, entry);
  }
  return [...series.values()]
    .map((entry) => {
      const course = courseById.get(entry.courseId) || {};
      const passing = passingByCourse.get(entry.courseId) || [DEFAULT_PASSING_SCORE];
      const passingScore = passing.reduce((total, value) => total + value, 0) / passing.length;
      const scores = entry.points.sort((left, right) => left.at - right.at).map((point) => point.score);
      const prediction = predictNext(scores, passingScore);
      return prediction && {
        studentId: entry.studentId,
        courseId: entry.courseId,
        sectionLabel: `${course.course_code || "Course"} - ${course.section || ""}`.trim(),
        scores,
        passingScore,
        ...prediction,
      };
    })
    .filter(Boolean)
    .sort((left, right) => LEVEL_RANK[left.level] - LEVEL_RANK[right.level] || left.predicted - right.predicted);
}

// Hides each series' latest score, predicts it from the earlier ones (High = predicted to fail), and compares.
export function backtest(history) {
  const counts = { evaluated: 0, tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const { scores, passingScore } of history) {
    if (scores.length < 3) continue;
    const prediction = predictNext(scores.slice(0, -1), passingScore);
    const predictedFail = prediction.level === "High";
    const failed = scores.at(-1) < passingScore;
    counts.evaluated += 1;
    if (predictedFail && failed) counts.tp += 1;
    else if (predictedFail) counts.fp += 1;
    else if (failed) counts.fn += 1;
    else counts.tn += 1;
  }
  return {
    ...counts,
    precision: counts.tp + counts.fp ? counts.tp / (counts.tp + counts.fp) : null,
    recall: counts.tp + counts.fn ? counts.tp / (counts.tp + counts.fn) : null,
    accuracy: counts.evaluated ? (counts.tp + counts.tn) / counts.evaluated : null,
    // What a "nobody fails" guess would score, so the accuracy has something to be compared with.
    baselineAccuracy: counts.evaluated ? (counts.tn + counts.fp) / counts.evaluated : null,
  };
}
