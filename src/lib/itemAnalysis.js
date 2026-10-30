// Classical test theory analytics for one exam: score summary, item difficulty (p), item discrimination (D,
// upper 27% minus lower 27%), distractor analysis and KR-20 reliability. Only auto-graded questions are
// analysed, using each student's final attempt.

export const DEFAULT_PASSING_SCORE = 60;
export const GROUP_SHARE = 0.27;
export const MIN_ATTEMPTS_FOR_FLAGS = 10;
export const TOO_EASY_P = 0.9;
export const TOO_HARD_P = 0.25;
export const WEAK_D = 0.2;
export const ACCEPTABLE_KR20 = 0.7;

const CHOICE_TYPES = new Set(["Multiple Choice", "Picture Choice"]);
const NO_ANSWER = "No answer";

export function attemptScore(attempt) {
  const score = Number(attempt?.score);
  if (attempt?.score !== null && attempt?.score !== undefined && Number.isFinite(score)) return score;
  const earned = Number(attempt?.earned_points);
  const max = Number(attempt?.max_points);
  return Number.isFinite(earned) && max > 0 ? (earned / max) * 100 : null;
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

export function summarizeScores(attempts, passingScore = DEFAULT_PASSING_SCORE) {
  const scores = attempts.map(attemptScore).filter((value) => value !== null);
  const sorted = [...scores].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const minutes = attempts
    .map((attempt) => (new Date(attempt.submitted_at).getTime() - new Date(attempt.started_at).getTime()) / 60000)
    .filter((value) => Number.isFinite(value) && value > 0);
  const bins = Array.from({ length: 10 }, (_, index) => ({
    label: index === 9 ? "90–100" : `${index * 10}–${index * 10 + 9}`,
    from: index * 10,
    count: 0,
  }));
  scores.forEach((score) => {
    bins[Math.min(9, Math.max(0, Math.floor(score / 10)))].count += 1;
  });
  const passed = scores.filter((score) => score >= passingScore).length;
  return {
    count: scores.length,
    mean: mean(scores),
    median: sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : null,
    highest: sorted.length ? sorted.at(-1) : null,
    lowest: sorted.length ? sorted[0] : null,
    passed,
    passRate: scores.length ? passed / scores.length : null,
    averageMinutes: mean(minutes),
    bins,
  };
}

// KR-20 for dichotomous items. rows: one array of 0/1 per student, one entry per item.
export function kr20(rows) {
  const items = rows[0]?.length || 0;
  if (items < 2 || rows.length < 2) return null;
  const totals = rows.map((row) => row.reduce((total, value) => total + value, 0));
  const average = mean(totals);
  const variance = totals.reduce((total, value) => total + (value - average) ** 2, 0) / totals.length;
  if (!variance) return null;
  let sumPQ = 0;
  for (let item = 0; item < items; item += 1) {
    const p = rows.reduce((total, row) => total + row[item], 0) / rows.length;
    sumPQ += p * (1 - p);
  }
  return (items / (items - 1)) * (1 - sumPQ / variance);
}

export function classifyItem({ p, d, attempts }) {
  if (attempts < MIN_ATTEMPTS_FOR_FLAGS || p === null || d === null) return "Need more attempts";
  if (d < 0) return "Revise";
  if (p > TOO_EASY_P) return "Too easy";
  if (p < TOO_HARD_P) return "Too hard";
  if (d < WEAK_D) return "Weak";
  return "Good";
}

function share(rows, test) {
  return rows.length ? rows.filter(test).length / rows.length : 0;
}

function choiceOptions(question) {
  if (CHOICE_TYPES.has(question.question_type)) {
    const choices = Array.isArray(question.choices) && question.choices.length ? question.choices : question.question_config?.choices || [];
    return choices.map((choice, index) => ({
      key: choice.key || String.fromCharCode(65 + index),
      label: String(choice.value ?? choice.text ?? choice.label ?? ""),
      ids: [choice.id, choice.key].filter(Boolean).map(String),
    }));
  }
  if (question.question_type === "True or False") {
    return ["True", "False"].map((value) => ({ key: value, label: value, ids: [value, value.toLowerCase()] }));
  }
  return null;
}

function correctIds(question) {
  const list = Array.isArray(question.correct_answers) && question.correct_answers.length ? question.correct_answers : [question.correct_answer];
  return list.filter((value) => value !== null && value !== undefined && value !== "").map(String);
}

function chosenKey(options, answer) {
  const value = answer?.answer;
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return NO_ANSWER;
  const text = String(Array.isArray(value) ? value[0] : value);
  const option = options.find((item) => item.ids.includes(text) || item.ids.some((id) => id.toLowerCase() === text.toLowerCase()));
  return option ? option.key : NO_ANSWER;
}

function distractorAnalysis(question, rows, upper, lower) {
  const options = choiceOptions(question);
  if (!options?.length) return { options: [], keyOutdrawn: null };
  const keys = correctIds(question);
  const keyedOption = options.find((option) => option.ids.some((id) => keys.includes(id)));
  const chosen = new Map(rows.map((row) => [row.attempt.id, chosenKey(options, row.answer)]));
  const all = [...options, { key: NO_ANSWER, label: NO_ANSWER, ids: [] }];
  const result = all.map((option) => ({
    key: option.key,
    label: option.label,
    isKey: option === keyedOption,
    total: rows.filter((row) => chosen.get(row.attempt.id) === option.key).length,
    share: share(rows, (row) => chosen.get(row.attempt.id) === option.key),
    upperShare: share(upper, (row) => chosen.get(row.attempt.id) === option.key),
    lowerShare: share(lower, (row) => chosen.get(row.attempt.id) === option.key),
  })).filter((option) => option.key !== NO_ANSWER || option.total > 0);
  const keyed = result.find((option) => option.isKey);
  const rival = result
    .filter((option) => !option.isKey && option.key !== NO_ANSWER)
    .sort((left, right) => right.upperShare - left.upperShare)[0];
  const keyOutdrawn = keyed && rival && upper.length && rival.upperShare > keyed.upperShare ? { key: rival.key, label: rival.label } : null;
  return { options: result, keyOutdrawn };
}

const FLAG_GROUP = { Good: "good", Weak: "review", "Too easy": "review", "Too hard": "review", Revise: "revise", "Need more attempts": "pending" };

function recommendationsFor(items, reliability, attemptCount) {
  const list = [];
  items.filter((item) => item.keyOutdrawn).forEach((item) => list.push({
    title: `Check the answer key for Question ${item.number}`,
    detail: `More top students chose ${item.keyOutdrawn.key} (“${item.keyOutdrawn.label}”) than the correct answer.`,
  }));
  items.filter((item) => item.flag === "Revise").forEach((item) => list.push({
    title: `Revise Question ${item.number}`,
    detail: `Negative discrimination (${item.d.toFixed(2)}): weaker students answered it correctly more often than stronger ones.`,
  }));
  items.filter((item) => item.flag === "Too hard").forEach((item) => list.push({
    title: `Review Question ${item.number} with the class`,
    detail: `Only ${Math.round(item.p * 100)}% answered correctly. The topic may need more teaching, or the wording may be unclear.`,
  }));
  items.filter((item) => item.flag === "Too easy").forEach((item) => list.push({
    title: `Make Question ${item.number} more challenging`,
    detail: `${Math.round(item.p * 100)}% answered correctly, so it barely separates stronger from weaker students.`,
  }));
  items.filter((item) => item.flag === "Weak").forEach((item) => list.push({
    title: `Improve Question ${item.number}`,
    detail: `Low discrimination (${item.d.toFixed(2)}): stronger and weaker students did about the same. Check its choices.`,
  }));
  if (reliability !== null && reliability < ACCEPTABLE_KR20 && attemptCount >= MIN_ATTEMPTS_FOR_FLAGS) list.push({
    title: "Raise the exam's reliability",
    detail: `KR-20 is ${reliability.toFixed(2)} (0.70 or higher is acceptable). Revising weak questions or adding good ones raises it.`,
  });
  return list;
}

export function analyzeExam({ questions, attempts, answers, passingScore = DEFAULT_PASSING_SCORE }) {
  const ranked = attempts
    .map((attempt) => ({ attempt, score: attemptScore(attempt) ?? 0 }))
    .sort((left, right) => right.score - left.score || String(left.attempt.id).localeCompare(String(right.attempt.id)));
  const attemptCount = ranked.length;
  const groupSize = attemptCount ? Math.max(1, Math.round(attemptCount * GROUP_SHARE)) : 0;
  const answerFor = new Map(answers.map((answer) => [`${answer.attempt_id}:${answer.question_id}`, answer]));

  const items = questions
    .map((question, index) => ({ question, number: index + 1 }))
    .filter(({ question }) => !question.manual_grading)
    .map(({ question, number }) => {
      const rows = ranked.map(({ attempt }) => {
        const answer = answerFor.get(`${attempt.id}:${question.id}`);
        return { attempt, answer, correct: answer?.is_correct === true ? 1 : 0 };
      });
      const upper = rows.slice(0, groupSize);
      const lower = groupSize ? rows.slice(-groupSize) : [];
      const p = rows.length ? rows.reduce((total, row) => total + row.correct, 0) / rows.length : null;
      const upperP = upper.length ? upper.reduce((total, row) => total + row.correct, 0) / upper.length : null;
      const lowerP = lower.length ? lower.reduce((total, row) => total + row.correct, 0) / lower.length : null;
      const d = upperP === null || lowerP === null ? null : upperP - lowerP;
      const { options, keyOutdrawn } = distractorAnalysis(question, rows, upper, lower);
      return {
        id: question.id,
        number,
        text: question.question_text || "",
        type: question.question_type || "",
        p,
        upperP,
        lowerP,
        d,
        flag: classifyItem({ p, d, attempts: attemptCount }),
        options,
        keyOutdrawn,
        rows,
      };
    });

  const reliability = kr20(ranked.map((_, rowIndex) => items.map((item) => item.rows[rowIndex].correct)));
  const quality = { good: 0, review: 0, revise: 0, pending: 0 };
  items.forEach((item) => {
    quality[FLAG_GROUP[item.flag]] += 1;
  });

  return {
    attemptCount,
    groupSize,
    passingScore,
    summary: summarizeScores(attempts, passingScore),
    kr20: reliability,
    quality,
    items: items.map((item) => {
      const result = { ...item };
      delete result.rows;
      return result;
    }),
    recommendations: recommendationsFor(items, reliability, attemptCount),
  };
}
