import { CHOICE_KEYS, QUESTION_DIFFICULTIES } from "./aiQuestionGenerator.js";

// Sample generator used until the AI Edge Function is connected. It builds fill-in-the-word questions
// straight from the PDF text, so every question is grounded and deterministic for the same input.

const MIN_SENTENCE_LENGTH = 40;
const MAX_SENTENCE_LENGTH = 240;
const ANSWER_WORDS_PER_SENTENCE = 2;
const SAMPLE_DELAY_MS = 700;

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

function buildCandidates(pages) {
  const vocabulary = [...new Map(pages.flatMap((page) => contentWords(page.text)).map((word) => [word.toLowerCase(), word])).values()];
  const sentences = pages.flatMap((page) => splitSentences(page.text).map((sentence) => ({ page: page.page, sentence })));
  const candidates = [];

  for (let rank = 0; rank < ANSWER_WORDS_PER_SENTENCE; rank += 1) {
    for (const { page, sentence } of sentences) {
      const sentenceWords = contentWords(sentence);
      const inSentence = new Set(sentenceWords.map((word) => word.toLowerCase()));
      const answer = [...new Set(sentenceWords)].sort((left, right) => right.length - left.length || left.localeCompare(right))[rank];
      if (!answer) continue;

      const distractors = vocabulary
        .filter((word) => !inSentence.has(word.toLowerCase()))
        .sort((left, right) => hashText(`${sentence}:${left}`) - hashText(`${sentence}:${right}`))
        .slice(0, CHOICE_KEYS.length - 1);
      if (distractors.length < CHOICE_KEYS.length - 1) continue;

      const position = sentence.indexOf(answer);
      const blanked = `${sentence.slice(0, position)}_____${sentence.slice(position + answer.length)}`;
      candidates.push({ page, sentence, answer, distractors, question: `According to page ${page}, which word completes this statement? "${blanked}"` });
    }
  }
  return candidates;
}

export function createFakeQuestions({ pages, count, difficulty, avoidStems = [] }) {
  const avoid = new Set(avoidStems);
  return buildCandidates(pages)
    .filter((candidate) => !avoid.has(candidate.question))
    .slice(0, count)
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

export function requestSampleQuestions({ signal, ...options }) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      globalThis.clearTimeout(timer);
      reject(new globalThis.DOMException("Generation was cancelled.", "AbortError"));
    };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve({ questions: createFakeQuestions(options) });
    }, SAMPLE_DELAY_MS);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
