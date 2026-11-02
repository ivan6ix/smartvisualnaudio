/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ROWS_PER_REQUEST, fetchAllRows } from "../src/lib/fetchAllRows.js";

// A fake query that behaves like the API: at most `cap` rows per request, exact count only when asked.
function fakeTable(total, { cap = ROWS_PER_REQUEST, failFrom = null } = {}) {
  const calls = [];
  const build = (options) => ({
    range(from, to) {
      calls.push({ from, to, counted: Boolean(options?.count) });
      if (failFrom !== null && from >= failFrom) return Promise.resolve({ data: null, error: { message: "page failed" } });
      const end = Math.min(total - 1, to, from + cap - 1);
      const data = Array.from({ length: Math.max(0, end - from + 1) }, (_, index) => ({ id: from + index }));
      return Promise.resolve({ data, error: null, count: options?.count ? total : null });
    },
  });
  return { build, calls };
}

// Small tables: one request.
{
  const table = fakeTable(37);
  const result = await fetchAllRows(table.build);
  assert.equal(result.data.length, 37);
  assert.equal(table.calls.length, 1);
  assert.equal(table.calls[0].counted, true);
}
// Large tables: every row, no gaps or repeats, remaining pages without a count.
{
  const table = fakeTable(2501);
  const result = await fetchAllRows(table.build);
  assert.equal(result.data.length, 2501);
  assert.deepEqual(result.data.map((row) => row.id), Array.from({ length: 2501 }, (_, index) => index));
  assert.deepEqual(table.calls.map((call) => [call.from, call.to, call.counted]), [[0, 999, true], [1000, 1999, false], [2000, 2500, false]]);
}
// Exactly one full page is not read twice; errors are returned, not partial data.
{
  const table = fakeTable(1000);
  assert.equal((await fetchAllRows(table.build)).data.length, 1000);
  assert.equal(table.calls.length, 1);
  const failing = fakeTable(2500, { failFrom: 2000 });
  assert.deepEqual(await fetchAllRows(failing.build), { data: null, error: { message: "page failed" } });
}

// The Scores page reads every table in full, filters by exam or course (short request addresses), loads in two
// rounds, and groups rows once instead of rescanning them per question.
const page = readFileSync("src/pages/professor/ProfessorScores.jsx", "utf8");
assert.doesNotMatch(page, /\.in\("attempt_id", attemptIds\)/, "Answers must not be requested by listing every attempt id.");
assert.match(page, /from\("exam_attempt_answers"\)[\s\S]*?exam_attempts!inner\(exam_id\)[\s\S]*?\.in\("exam_attempts\.exam_id", examIds\)/);
assert.match(page, /from\("exam_attempt_reopen_requests"\)[\s\S]*?\.in\("exam_id", examIds\)/);
assert.doesNotMatch(page, /\.limit\(\d+\)/, "The API caps rows per request; use fetchAllRows instead of a large limit.");
assert.match(page, /await Promise\.all\(\[\s*supabase\s*\.from\("courses"\)[\s\S]*?\.from\("exams"\)/, "Courses and exams load together.");
assert.doesNotMatch(page, /attempts\.find\(\(item\) => item\.id === answer\.attempt_id\)/, "No per-answer scan of every attempt.");
assert.match(page, /const answersByQuestion = useMemo/);

console.log("Scores loading checks passed.");
