/* global console */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import {
  CHOICE_KEYS,
  GENERATION_LIMITS,
  createFakeQuestions,
  shuffleChoices,
  validateGeneratedQuestions,
  validateGenerationRequest,
} from "../supabase/functions/generate-mcq/mcq.js";

const sentence = "Photosynthesis converts light energy into chemical energy stored in glucose molecules. ";
const pages = [
  { page: 3, text: sentence.repeat(3) },
  { page: 4, text: "The mitochondrion is the “powerhouse” of the cell.\nIt produces ATP during cellular respiration." },
];
const validBody = {
  requestKey: "6f1c1d2e-8a4b-4c3d-9e5f-0a1b2c3d4e5f",
  pages,
  count: 5,
  difficulty: "Mixed",
  avoidStems: ["Old question?"],
};

// Request validation: shape, limits and enums are enforced before anything is generated.
const { request, error } = validateGenerationRequest(validBody);
assert.equal(error, "");
assert.deepEqual(request, { ...validBody });
assert.deepEqual(validateGenerationRequest({ ...validBody, avoidStems: undefined }).request.avoidStems, []);
const rejects = (body, pattern) => assert.match(validateGenerationRequest(body).error, pattern);
rejects(null, /Invalid request/);
rejects([], /Invalid request/);
rejects({ ...validBody, requestKey: "not-a-uuid" }, /request key/);
rejects({ ...validBody, count: 0 }, /1 and 20/);
rejects({ ...validBody, count: 21 }, /1 and 20/);
rejects({ ...validBody, count: 2.5 }, /1 and 20/);
rejects({ ...validBody, difficulty: "Brutal" }, /difficulty/);
rejects({ ...validBody, pages: [] }, /pages/);
rejects({ ...validBody, pages: "text" }, /pages/);
rejects({ ...validBody, pages: Array.from({ length: GENERATION_LIMITS.maxPages + 1 }, (_, index) => ({ page: index + 1, text: sentence })) }, /100 pages/);
rejects({ ...validBody, pages: [{ page: 0, text: sentence.repeat(3) }] }, /page number/);
rejects({ ...validBody, pages: [{ page: 1, text: sentence.repeat(3) }, { page: 1, text: sentence }] }, /page number/);
rejects({ ...validBody, pages: [{ page: 1, text: 42 }] }, /page text/);
rejects({ ...validBody, pages: [{ page: 1, text: "Too short." }] }, /not enough text/);
rejects({ ...validBody, pages: [{ page: 1, text: "x".repeat(GENERATION_LIMITS.maxTotalChars + 1) }] }, /too much text/);
rejects({ ...validBody, avoidStems: "nope" }, /avoid/);
rejects({ ...validBody, avoidStems: Array.from({ length: GENERATION_LIMITS.maxAvoidStems + 1 }, (_, index) => `Q${index}`) }, /avoid/);
rejects({ ...validBody, avoidStems: [42] }, /avoid/);

// Output validation keeps only well-formed questions and marks whether the quote is on the cited page.
const good = {
  question: "What does the mitochondrion produce?",
  choices: { A: "Glucose", B: "ATP", C: "Chlorophyll", D: "Oxygen" },
  correct: "B",
  difficulty: "Easy",
  explanation: "Page 4 says it produces ATP.",
  sourcePage: 4,
  evidence: "It produces ATP during cellular respiration.",
};
const context = { pages, count: 5, difficulty: "Mixed", avoidStems: ["Old question?"] };
const result = validateGeneratedQuestions([
  good,
  { ...good, question: "  what does the MITOCHONDRION produce? " },
  { ...good, question: "Old question?" },
  { ...good, question: "Missing a choice?", choices: { A: "1", B: "2", C: "3" } },
  { ...good, question: "Duplicate choices?", choices: { A: "ATP", B: " atp ", C: "x", D: "y" } },
  { ...good, question: "Bad key?", correct: "E" },
  { ...good, question: "Catch-all?", choices: { A: "ATP", B: "Glucose", C: "Oxygen", D: "All of the above" } },
  { ...good, question: "" },
  { ...good, question: "x".repeat(GENERATION_LIMITS.maxStemLength + 1) },
  { ...good, question: "Wrong page?", sourcePage: 9 },
  { ...good, question: "Invented quote?", evidence: "Ribosomes make proteins." },
  { ...good, question: "Odd difficulty?", difficulty: "Brutal" },
  "not an object",
], context);
assert.deepEqual(result.questions.map((item) => item.question), ["What does the mitochondrion produce?", "Wrong page?", "Invented quote?", "Odd difficulty?"]);
assert.equal(result.rejected, 9);
assert.equal(result.questions[0].verified, true);
assert.equal(result.questions[1].verified, false, "A page that was not sent is unverified.");
assert.equal(result.questions[2].verified, false, "A quote missing from the page is unverified.");
assert.equal(result.questions[3].difficulty, "Moderate");
assert.deepEqual(Object.keys(result.questions[0]).sort(), ["choices", "correct", "difficulty", "evidence", "explanation", "question", "sourcePage", "verified"]);
assert.equal(validateGeneratedQuestions([good, { ...good, question: "Second?" }], { ...context, count: 1 }).questions.length, 1, "Never return more than requested.");
assert.equal(validateGeneratedQuestions({ questions: [good] }, context).questions.length, 0, "Only an array of questions is accepted.");
const long = validateGeneratedQuestions([{ ...good, explanation: "e".repeat(5000), evidence: `It produces ATP during cellular respiration.${" ".repeat(10)}` }], context).questions[0];
assert.equal(long.explanation.length, GENERATION_LIMITS.maxExplanationLength);
assert.equal(validateGeneratedQuestions([{ ...good, difficulty: "Hard" }], { ...context, difficulty: "Easy" }).questions[0].difficulty, "Easy", "A fixed difficulty request labels every question with it.");

// Shuffling keeps the correct answer text attached to the correct key.
const shuffled = shuffleChoices(good, () => 0);
assert.equal(shuffled.choices[shuffled.correct], "ATP");
assert.deepEqual(Object.values(shuffled.choices).sort(), Object.values(good.choices).sort());
assert.notDeepEqual(shuffled.choices, good.choices);

// The sample generator is deterministic, grounded in the text, and respects count and difficulty.
const notes = [
  { page: 1, text: "Photosynthesis converts light energy into chemical energy inside chloroplasts. Chlorophyll absorbs mostly blue and red wavelengths of light." },
  { page: 2, text: "Cellular respiration releases energy from glucose through glycolysis, the Krebs cycle, and oxidative phosphorylation in mitochondria." },
  { page: 3, text: "Enzymes lower the activation energy of reactions without being consumed. Temperature and acidity strongly influence enzyme activity." },
];
const fake = createFakeQuestions({ pages: notes, count: 6, difficulty: "Mixed" });
assert.equal(fake.length, 6);
assert.deepEqual(fake.map((item) => item.difficulty), ["Easy", "Moderate", "Hard", "Easy", "Moderate", "Hard"]);
const checkedFake = validateGeneratedQuestions(fake, { pages: notes, count: 6, difficulty: "Mixed", avoidStems: [] });
assert.equal(checkedFake.rejected, 0);
assert.ok(checkedFake.questions.every((item) => item.verified && CHOICE_KEYS.includes(item.correct)));
assert.deepEqual(createFakeQuestions({ pages: notes, count: 3, difficulty: "Easy" }), createFakeQuestions({ pages: notes, count: 3, difficulty: "Easy" }));
const avoided = createFakeQuestions({ pages: notes, count: 2, difficulty: "Hard", avoidStems: fake.map((item) => item.question) });
assert.ok(avoided.length === 2 && avoided.every((item) => !fake.some((other) => other.question === item.question)), "Regenerated questions avoid existing stems.");

// The request log stores no PDF content, is service-role only, and claims a slot atomically.
const migrationName = readdirSync("supabase/migrations").find((name) => name.endsWith("_ai_question_generation_requests.sql"));
assert.ok(migrationName, "The AI request log migration must exist.");
const migration = readFileSync(`supabase/migrations/${migrationName}`, "utf8");
const table = migration.match(/create table if not exists public\.ai_question_generation_requests \(([\s\S]*?)\n\);/)?.[1] || "";
assert.ok(table, "The request log table must be defined.");
assert.match(table, /unique \(user_id, request_key\)/);
assert.doesNotMatch(table, /\btext_content\b|\bpages\b|\bprompt\b|\bquestion_text\b|\bpdf\b/i, "The log must not store PDF text, prompts or questions.");
assert.match(migration, /alter table public\.ai_question_generation_requests enable row level security;/);
assert.match(migration, /revoke all on table public\.ai_question_generation_requests from public, anon, authenticated;/);
assert.match(migration, /create or replace function public\.claim_ai_question_generation\([\s\S]*?security definer\s+set search_path = public/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /revoke all on function public\.claim_ai_question_generation\([^)]*\) from public, anon, authenticated;/);
assert.match(migration, /grant execute on function public\.claim_ai_question_generation\([^)]*\) to service_role;/);
assert.doesNotMatch(migration, /grant [^;]*to (anon|authenticated)/);

// The Edge Function authenticates, allows only active professors, limits input, and never logs content.
const fn = readFileSync("supabase/functions/generate-mcq/index.ts", "utf8");
assert.match(fn, /from "\.\/mcq\.js"/);
assert.match(fn, /req\.method !== "POST"[\s\S]*405/);
assert.match(fn, /auth\.getUser\(\)[\s\S]*Unauthorized request\.[\s\S]*401/);
assert.match(fn, /caller\.role !== "Professor" \|\| caller\.status !== "Active"[\s\S]*403/);
assert.match(fn, /GENERATION_LIMITS\.maxBodyBytes[\s\S]*413/);
assert.match(fn, /validateGenerationRequest\(/);
assert.match(fn, /rpc\("claim_ai_question_generation"/);
assert.match(fn, /Deno\.env\.get\("MCQ_FORCE_FAKE"\) === "true"/);
assert.match(fn, /validateGeneratedQuestions\(/);
assert.match(fn, /shuffleChoices\(/);
assert.doesNotMatch(fn, /console\.(log|info|warn|error)\([^)]*(body|pages|text|question|raw)/, "Never log PDF text or generated questions.");
assert.doesNotMatch(fn, /error\.message|String\(error\)/, "Never echo internal error details.");

console.log("AI question Edge Function checks passed.");
