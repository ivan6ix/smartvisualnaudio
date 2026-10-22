// Pure rules for the generate-mcq Edge Function. Plain JavaScript with no imports so Deno can run it and
// the Node check scripts can test it.

export const CHOICE_KEYS = ["A", "B", "C", "D"];
export const QUESTION_DIFFICULTIES = ["Easy", "Moderate", "Hard"];
export const REQUEST_DIFFICULTIES = [...QUESTION_DIFFICULTIES, "Mixed"];

export const GENERATION_LIMITS = {
  maxPages: 100,
  maxPageNumber: 10000,
  minTotalChars: 200,
  maxTotalChars: 240000,
  maxQuestions: 20,
  maxAvoidStems: 100,
  maxStemLength: 1000,
  maxChoiceLength: 300,
  maxExplanationLength: 600,
  maxEvidenceLength: 400,
  maxBodyBytes: 2 * 1024 * 1024,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATCH_ALL_CHOICE = /^(all|none|both|neither) of the (above|choices|options)\.?$/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function comparableText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, "\"")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function evidenceAppearsOnPage(evidence, pageText) {
  const quote = comparableText(evidence);
  return Boolean(quote) && comparableText(pageText).includes(quote);
}

export function validateGenerationRequest(body) {
  const fail = (error) => ({ request: null, error });
  if (!isPlainObject(body)) return fail("Invalid request.");

  const requestKey = String(body.requestKey || "");
  if (!UUID_PATTERN.test(requestKey)) return fail("Invalid request key.");

  const count = Number(body.count);
  if (!Number.isInteger(count) || count < 1 || count > GENERATION_LIMITS.maxQuestions) {
    return fail(`Request between 1 and ${GENERATION_LIMITS.maxQuestions} questions at a time.`);
  }

  const difficulty = String(body.difficulty || "");
  if (!REQUEST_DIFFICULTIES.includes(difficulty)) return fail("Choose a valid difficulty.");

  if (!Array.isArray(body.pages) || !body.pages.length) return fail("Send the PDF pages to generate from.");
  if (body.pages.length > GENERATION_LIMITS.maxPages) return fail(`Send ${GENERATION_LIMITS.maxPages} pages or fewer.`);
  const seenPages = new Set();
  let totalChars = 0;
  for (const page of body.pages) {
    const pageNumber = Number(page?.page);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > GENERATION_LIMITS.maxPageNumber || seenPages.has(pageNumber)) {
      return fail("Each page needs a unique page number.");
    }
    if (typeof page.text !== "string") return fail("Each page text must be a string.");
    seenPages.add(pageNumber);
    totalChars += page.text.length;
  }
  if (totalChars < GENERATION_LIMITS.minTotalChars) return fail("The PDF has not enough text to generate questions.");
  if (totalChars > GENERATION_LIMITS.maxTotalChars) return fail("The PDF has too much text. Choose a smaller page range.");

  const avoidStems = body.avoidStems ?? [];
  if (!Array.isArray(avoidStems) || avoidStems.length > GENERATION_LIMITS.maxAvoidStems
    || avoidStems.some((stem) => typeof stem !== "string" || stem.length > GENERATION_LIMITS.maxStemLength)) {
    return fail("Invalid list of questions to avoid.");
  }

  return {
    request: {
      requestKey,
      pages: body.pages.map((page) => ({ page: Number(page.page), text: page.text })),
      count,
      difficulty,
      avoidStems,
    },
    error: "",
  };
}

function normalizeQuestion(raw, pages, difficulty) {
  if (!isPlainObject(raw) || !isPlainObject(raw.choices)) return null;
  const question = String(raw.question || "").trim();
  if (!question || question.length > GENERATION_LIMITS.maxStemLength) return null;

  const choices = Object.fromEntries(CHOICE_KEYS.map((key) => [key, String(raw.choices[key] ?? "").trim()]));
  const values = Object.values(choices);
  if (values.some((value) => !value || value.length > GENERATION_LIMITS.maxChoiceLength || CATCH_ALL_CHOICE.test(value))) return null;
  if (new Set(values.map(comparableText)).size !== CHOICE_KEYS.length) return null;
  if (!CHOICE_KEYS.includes(raw.correct)) return null;

  const sourcePage = Number(raw.sourcePage) || 0;
  const evidence = String(raw.evidence || "").trim().slice(0, GENERATION_LIMITS.maxEvidenceLength);
  const page = pages.find((item) => item.page === sourcePage);
  return {
    question,
    choices,
    correct: raw.correct,
    difficulty: difficulty !== "Mixed" ? difficulty : QUESTION_DIFFICULTIES.includes(raw.difficulty) ? raw.difficulty : "Moderate",
    explanation: String(raw.explanation || "").trim().slice(0, GENERATION_LIMITS.maxExplanationLength),
    sourcePage,
    evidence,
    verified: Boolean(page) && evidenceAppearsOnPage(evidence, page.text),
  };
}

export function validateGeneratedQuestions(rawQuestions, { pages, count, difficulty, avoidStems = [] }) {
  if (!Array.isArray(rawQuestions)) return { questions: [], rejected: 0 };
  const seen = new Set(avoidStems.map(comparableText));
  const questions = [];
  let rejected = 0;
  for (const raw of rawQuestions) {
    const question = normalizeQuestion(raw, pages, difficulty);
    if (!question || seen.has(comparableText(question.question))) {
      rejected += 1;
      continue;
    }
    seen.add(comparableText(question.question));
    if (questions.length < count) questions.push(question);
  }
  return { questions, rejected };
}

// Models tend to favour one answer position, so the order is shuffled after generation.
export function shuffleChoices(item, random = Math.random) {
  const values = CHOICE_KEYS.map((key) => item.choices[key]);
  const correctValue = item.choices[item.correct];
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  const choices = Object.fromEntries(CHOICE_KEYS.map((key, index) => [key, values[index]]));
  return { ...item, choices, correct: CHOICE_KEYS[values.indexOf(correctValue)] };
}

// Sample generator used while MCQ_FORCE_FAKE is on. It builds fill-in-the-word questions straight from the
// PDF text, so every question is grounded and deterministic for the same input.

const MIN_SENTENCE_LENGTH = 40;
const MAX_SENTENCE_LENGTH = 240;
const ANSWER_WORDS_PER_SENTENCE = 2;
const FAKE_VOCABULARY_LIMIT = 2000;

function hashText(value) {
  let hash = 0;
  for (const character of String(value)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function contentWords(text) {
  return (String(text).match(/[A-Za-z][A-Za-z-]{4,}/g) || []).map((word) => word.replace(/-+$/, ""));
}

function splitSentences(text) {
  return String(text)
    .replace(/\n/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= MIN_SENTENCE_LENGTH && sentence.length <= MAX_SENTENCE_LENGTH);
}

// Candidates are produced lazily and each word is hashed once per sentence, so a full-size PDF stays well
// inside the Edge Function CPU limit.
function* fakeCandidates(pages) {
  const vocabulary = [...new Map(pages.flatMap((page) => contentWords(page.text)).map((word) => [word.toLowerCase(), word])).values()]
    .slice(0, FAKE_VOCABULARY_LIMIT);
  const sentences = pages.flatMap((page) => splitSentences(page.text).map((sentence) => ({ page: page.page, sentence })));

  for (let rank = 0; rank < ANSWER_WORDS_PER_SENTENCE; rank += 1) {
    for (const { page, sentence } of sentences) {
      const sentenceWords = contentWords(sentence);
      const inSentence = new Set(sentenceWords.map((word) => word.toLowerCase()));
      const answer = [...new Set(sentenceWords)].sort((left, right) => right.length - left.length || left.localeCompare(right))[rank];
      if (!answer) continue;

      const distractors = vocabulary
        .filter((word) => !inSentence.has(word.toLowerCase()))
        .map((word) => [hashText(`${sentence}:${word}`), word])
        .sort((left, right) => left[0] - right[0])
        .slice(0, CHOICE_KEYS.length - 1)
        .map(([, word]) => word);
      if (distractors.length < CHOICE_KEYS.length - 1) continue;

      const position = sentence.indexOf(answer);
      const blanked = `${sentence.slice(0, position)}_____${sentence.slice(position + answer.length)}`;
      yield { page, sentence, answer, distractors, question: `According to page ${page}, which word completes this statement? "${blanked}"` };
    }
  }
}

export function createFakeQuestions({ pages, count, difficulty, avoidStems = [] }) {
  const avoid = new Set(avoidStems);
  const picked = [];
  for (const candidate of fakeCandidates(pages)) {
    if (avoid.has(candidate.question)) continue;
    avoid.add(candidate.question);
    picked.push(candidate);
    if (picked.length >= count) break;
  }
  return picked
    .map((candidate, index) => {
      const correctIndex = hashText(candidate.question) % CHOICE_KEYS.length;
      const values = [...candidate.distractors];
      values.splice(correctIndex, 0, candidate.answer);
      return {
        question: candidate.question,
        choices: Object.fromEntries(CHOICE_KEYS.map((key, choiceIndex) => [key, values[choiceIndex]])),
        correct: CHOICE_KEYS[correctIndex],
        difficulty: difficulty === "Mixed" ? QUESTION_DIFFICULTIES[index % QUESTION_DIFFICULTIES.length] : difficulty,
        explanation: `Page ${candidate.page} states: "${candidate.sentence}"`,
        sourcePage: candidate.page,
        evidence: candidate.sentence,
      };
    });
}
