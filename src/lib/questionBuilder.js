import { CHOICE_KEYS, MAX_CHOICE_TEXT_LENGTH, MAX_QUESTION_TEXT_LENGTH, QUESTION_DIFFICULTIES, comparableText, shuffleChoices } from "./pdfQuestionGenerator.js";

// Builds Multiple Choice questions from PDF text with plain rules: no AI service, no network, no cost.
// It finds definitions, key terms and numbers in well-formed sentences and turns them into five question
// styles. Wrong choices come from other terms in the same document that look like the right answer.

const MIN_SENTENCE_LENGTH = 50;
const MAX_SENTENCE_LENGTH = 240;
const MIN_SENTENCE_WORDS = 8;
const DISTRACTOR_POOL_SIZE = 600;
const WRONG_CHOICES = CHOICE_KEYS.length - 1;

const STOPWORDS = new Set(`a about above after again against all also although always am an and any are as at be because been
before being below between both but by can cannot could did do does doing down during each either else every few for from
further had has have having he her here hers him his how however i if in into is it its itself just like many may me might
more most much must my no nor not now of off often on once one only or other others our out over own per same shall she
should since so some such than that the their them then there these they this those through thus to too under until up upon
us usually very via was we were what when where whether which while who whom whose why will with within without would yet
you your ang ng mga sa na at ay ito iyon iyan para kung hindi may si ni ko mo niya nila namin natin kami kayo sila din rin
lamang lang pa po ba nang dahil kaya pero o`.split(/\s+/));
const CONTEXT_START = /^(it|its|this|these|they|them|their|that|those|he|she|his|her|we|our|you|your|i|such|however|therefore|thus|also|and|but|or|so|then|here|there|hence|moreover|furthermore)\b/i;
const LABEL_START = /^(figure|fig\.|table|chart|chapter|section|page|unit|lesson|module|activity|exercise|example|note)\b/i;
const SENTENCE_OPENING = /^(The|A|An|This|These|Those|It|Its|In|On|At|For|When|While|Although|However|Most|Many|Some|All|Each|Every|There|They|We|He|She|If|As|After|Before|During)\s/;
const DETERMINERS = new Set("the a an this these those each every its their his her our your all some many most several both any another of in on with from by into for".split(" "));
const VERB_CUES = new Set("that which who also often usually not can will may must should could would does do did to".split(" "));
const VERB_LIKE_ENDING = /[a-z]{3,}(ed|ing|ly)$/;
const ADJECTIVE_ENDING = /[a-z]{2,}(al|ic|ive|ous|ar|ent|ant|ful|less|ble|ary|ory)$/;
const NUMBER_LABEL_BEFORE = /(figure|fig\.|table|page|pages|chapter|section|unit|lesson|module|p\.|pp\.|no\.|step)\s*$/i;
const WORD_PATTERN = /[A-Za-z][A-Za-z'-]*[A-Za-z]|[A-Za-z]/g;
const NUMBER_PATTERN = /(?<![\w.])(\d{1,4}(?:\.\d+)?)(\s?%)?(?![\w]|\.\d)/g;
const TERM_WORDS = "[A-Za-z][A-Za-z'-]*(?:\\s+(?:of\\s+)?[A-Za-z][A-Za-z'-]*){0,3}";
const CALLED_PATTERN = new RegExp(`^(.{15,180}?)\\s+(?:is|are)\\s+(?:called|known as|termed|referred to as)\\s+(?:(?:an?|the)\\s+)?(${TERM_WORDS})$`);
const REFERS_PATTERN = new RegExp(`^(?:(?:an?|the)\\s+)?(${TERM_WORDS})\\s+(?:refers? to|(?:is|are) defined as|means)\\s+(.{15,180})$`, "i");
const IS_A_PATTERN = new RegExp(`^(?:(?:an?|the)\\s+)?(${TERM_WORDS})\\s+(?:is|are)\\s+((?:an?|the|one of the|a type of|a kind of|a form of)\\s.{12,180})$`, "i");

// Each difficulty prefers its own question styles; the order rotates so one style does not take every slot.
const KINDS_BY_LEVEL = {
  Easy: ["term", "cloze"],
  Moderate: ["definition", "cloze", "term"],
  Hard: ["statement", "number", "definition"],
};
const ALL_KINDS = ["term", "definition", "cloze", "number", "statement"];

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seedText) {
  let state = hashText(seedText) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function lowerFirst(value) {
  return value && /^[A-Z][a-z]/.test(value) ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
}

function isContentWord(word) {
  return word.length >= 3 && !STOPWORDS.has(word.toLowerCase());
}

// Joins wrapped lines back into running text. A short line without end punctuation followed by a
// capitalised line is a heading and is dropped. A longer line without end punctuation followed by a typical
// sentence opening ends a block, so a sentence that lost its period is not glued onto the next one.
function textBlocks(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const blocks = [[]];
  lines.forEach((line, index) => {
    const next = lines[index + 1] || "";
    const unfinished = !/[.!?:;,]$/.test(line);
    if (unfinished && line.split(/\s+/).length <= 8 && (!next || /^[A-Z0-9"“(]/.test(next))) {
      blocks.push([]);
      return;
    }
    blocks.at(-1).push(line);
    if (unfinished && SENTENCE_OPENING.test(next)) blocks.push([]);
  });
  return blocks.map((block) => block.join(" ").replace(/\s+/g, " ").trim()).filter(Boolean);
}

function isUsableSentence(text) {
  if (text.length < MIN_SENTENCE_LENGTH || text.length > MAX_SENTENCE_LENGTH) return false;
  if (!/[.!]$/.test(text) || CONTEXT_START.test(text) || LABEL_START.test(text)) return false;
  if (text.split(/\s+/).length < MIN_SENTENCE_WORDS || /https?:|www\.|@/.test(text)) return false;
  const letters = text.match(/[A-Za-z]/g) || [];
  const capitals = text.match(/[A-Z]/g) || [];
  return letters.length / text.length >= 0.6 && capitals.length / Math.max(letters.length, 1) < 0.5;
}

export function extractSentences(pages) {
  const sentences = [];
  for (const page of pages) {
    for (const block of textBlocks(String(page.text || ""))) {
      for (const part of block.split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/)) {
        const text = part.trim();
        if (isUsableSentence(text)) sentences.push({ page: page.page, text });
      }
    }
  }
  return sentences;
}

function validTerm(term) {
  const words = term.split(/\s+/);
  if (!words.length || words.length > 4 || term.length < 3) return false;
  return words.every((word, index) => word.toLowerCase() === "of" ? index > 0 && index < words.length - 1 : isContentWord(word));
}

export function findDefinition(sentence) {
  const text = String(sentence || "").trim().replace(/[.!]$/, "");
  if (CONTEXT_START.test(text)) return null;
  const called = text.match(CALLED_PATTERN);
  const refers = called ? null : text.match(REFERS_PATTERN);
  const isA = called || refers ? null : text.match(IS_A_PATTERN);
  const [term, definition] = called ? [called[2], lowerFirst(called[1])] : refers ? [refers[1], refers[2]] : isA ? [isA[1], isA[2]] : [];
  if (!term || !validTerm(term) || definition.split(/\s+/).length < 4) return null;
  if (comparableText(definition).includes(comparableText(term))) return null;
  return { term, definition };
}

function tokenize(text) {
  return [...text.matchAll(WORD_PATTERN)].map((match) => ({ text: match[0], start: match.index, end: match.index + match[0].length }));
}

// Rough noun test without a dictionary: nouns usually follow a determiner or preposition and end a noun
// phrase (a function word or punctuation comes next). Verbs follow words like "that" or "to".
function nounEvidence(sentence, first, last) {
  const { tokens, text } = sentence;
  const word = tokens[last].text.toLowerCase();
  const previous = tokens[first - 1]?.text.toLowerCase() || "";
  const beforePrevious = tokens[first - 2]?.text.toLowerCase() || "";
  const next = tokens[last + 1];
  if (VERB_LIKE_ENDING.test(word) || VERB_CUES.has(previous)) return { noun: 0, verb: 1 };
  const endsPhrase = !next || /[,.;:()]/.test(text.slice(tokens[last].end, next.start)) || STOPWORDS.has(next.text.toLowerCase());
  const afterDeterminer = DETERMINERS.has(previous) || (ADJECTIVE_ENDING.test(previous) && DETERMINERS.has(beforePrevious));
  const isName = first > 0 && /^[A-Z]/.test(tokens[first].text);
  if (!endsPhrase) return { noun: 0, verb: 0 };
  return { noun: afterDeterminer || isName ? 2 : 0.5, verb: 0 };
}

function isPlural(value) {
  const word = value.split(/\s+/).pop().toLowerCase();
  return /[^s]s$/.test(word) && !/(is|us|ss|ics)$/.test(word);
}

function analyse(pages) {
  const sentences = extractSentences(pages).map((sentence) => ({
    ...sentence,
    tokens: tokenize(sentence.text),
    definition: findDefinition(sentence.text),
  }));

  const glossary = new Map();
  const addTerm = (surface, { definition = false, sentenceStart = false, evidence = { noun: 0, verb: 0 } } = {}) => {
    const key = surface.toLowerCase();
    const entry = glossary.get(key) || { key, surface, count: 0, words: surface.split(/\s+/).length, capitalised: 0, lowercase: 0, definition: false, noun: 0, verb: 0 };
    entry.count += 1;
    entry.noun += evidence.noun;
    entry.verb += evidence.verb;
    if (!sentenceStart) {
      if (/^[A-Z]/.test(surface)) entry.capitalised += 1;
      else entry.lowercase += 1;
    }
    entry.definition ||= definition;
    glossary.set(key, entry);
  };

  for (const sentence of sentences) {
    const seen = new Set();
    const { tokens } = sentence;
    for (let index = 0; index < tokens.length; index += 1) {
      for (let size = 1; size <= 3 && index + size <= tokens.length; size += 1) {
        const run = tokens.slice(index, index + size);
        if (!run.every((token) => isContentWord(token.text)) || (size === 1 && run[0].text.length < 4)) break;
        const surface = sentence.text.slice(run[0].start, run[size - 1].end);
        if (seen.has(surface.toLowerCase())) continue;
        seen.add(surface.toLowerCase());
        addTerm(surface, { sentenceStart: index === 0, evidence: nounEvidence(sentence, index, index + size - 1) });
      }
    }
    if (sentence.definition) addTerm(sentence.definition.term, { definition: true, sentenceStart: sentence.text.startsWith(sentence.definition.term) });
  }

  for (const [key, entry] of glossary) {
    // Only noun-like terms are used as answers and wrong choices, so choices read as the same kind of word.
    const nounLike = entry.definition || (entry.noun >= 1.5 && entry.noun > entry.verb);
    const keep = nounLike && (entry.definition || (entry.words === 1 ? entry.count >= 2 || key.length >= 7 : entry.count >= 2));
    if (!keep) {
      glossary.delete(key);
      continue;
    }
    // Terms written with a capital letter in the middle of sentences are names; others are common nouns.
    entry.display = entry.capitalised > entry.lowercase ? capitalize(entry.surface) : entry.surface.toLowerCase();
    entry.importance = entry.count * (entry.words > 1 ? 1.5 : 1) + (entry.definition ? 4 : 0);
  }

  const pool = [...glossary.values()].sort((left, right) => right.importance - left.importance || left.key.localeCompare(right.key)).slice(0, DISTRACTOR_POOL_SIZE);
  for (const sentence of sentences) {
    const lower = sentence.text.toLowerCase();
    sentence.keyTerms = [];
    const { tokens } = sentence;
    for (let index = 0; index < tokens.length; index += 1) {
      for (let size = 3; size >= 1; size -= 1) {
        if (index + size > tokens.length) continue;
        const surface = sentence.text.slice(tokens[index].start, tokens[index + size - 1].end);
        const entry = glossary.get(surface.toLowerCase());
        if (!entry || sentence.keyTerms.some((term) => term.key === entry.key)) continue;
        if (lower.split(entry.key).length > 2) continue;
        sentence.keyTerms.push({ ...entry, surface });
      }
    }
    sentence.keyTerms.sort((left, right) => right.importance - left.importance || right.words - left.words);
    sentence.numbers = [...sentence.text.matchAll(NUMBER_PATTERN)]
      .filter((match) => !NUMBER_LABEL_BEFORE.test(sentence.text.slice(Math.max(0, match.index - 12), match.index)))
      .map((match) => ({ value: match[1], suffix: (match[2] || "").trim(), start: match.index, end: match.index + match[0].length }));
    sentence.score = (sentence.definition ? 3 : 0) + Math.min(sentence.keyTerms.length, 3) + (sentence.numbers.length ? 1 : 0);
  }

  return {
    sentences,
    glossary,
    pool,
    definitions: sentences.filter((sentence) => sentence.definition).map((sentence) => sentence.definition),
    allText: comparableText(pages.map((page) => page.text).join(" ")),
  };
}

function shapeScore(candidate, answer) {
  const candidateWords = candidate.split(/\s+/).length;
  const answerWords = answer.split(/\s+/).length;
  const ratio = candidate.length / Math.max(answer.length, 1);
  let score = candidateWords === answerWords ? 3 : 0;
  score += isPlural(candidate) === isPlural(answer) ? 2 : -2;
  if (ratio >= 0.67 && ratio <= 1.5) score += 2;
  if (candidate.length >= 5 && answer.length >= 5 && candidate.slice(-3).toLowerCase() === answer.slice(-3).toLowerCase()) score += 1.5;
  if (/^[A-Z]/.test(candidate) === /^[A-Z]/.test(answer)) score += 0.5;
  return score;
}

// Hard questions get the most similar wrong choices; easier ones pick from a wider, shuffled set.
// The exclude check can be expensive, so it only runs on candidates in picking order.
function pickSimilar(answer, candidates, { level, random, exclude = () => false }) {
  const answerKey = comparableText(answer);
  const valid = [];
  const seen = new Set([answerKey]);
  for (const candidate of candidates) {
    const key = comparableText(candidate);
    if (!key || seen.has(key) || key.includes(answerKey) || answerKey.includes(key)) continue;
    seen.add(key);
    valid.push({ candidate, score: shapeScore(candidate, answer) + random() * 0.5 });
  }
  if (valid.length < WRONG_CHOICES) return null;
  valid.sort((left, right) => right.score - left.score);
  const window = level === "Hard" ? WRONG_CHOICES : level === "Moderate" ? 10 : 25;
  const ordered = [...shuffled(valid.slice(0, window), random), ...valid.slice(window)];
  const picked = [];
  for (const item of ordered) {
    if (exclude(item.candidate)) continue;
    picked.push(item.candidate);
    if (picked.length === WRONG_CHOICES) return picked;
  }
  return null;
}

function matchCase(candidate, answer) {
  if (/^[A-Z]/.test(answer)) return capitalize(candidate);
  return candidate;
}

function blank(text, start, end) {
  return `${text.slice(0, start)}_____${text.slice(end)}`;
}

function containsText(haystack, needle) {
  return comparableText(haystack).includes(comparableText(needle));
}

function sentenceKey(sentence) {
  sentence.comparable ||= comparableText(sentence.text);
  return sentence.comparable;
}

const builders = {
  term(sentence, context, level, random) {
    const found = sentence.definition;
    if (!found) return null;
    const question = /^(the|a|an)\s/i.test(found.definition)
      ? `Which term refers to ${found.definition}?`
      : `Which term is described as: ${found.definition}?`;
    const answer = capitalize(found.term);
    // Other defined terms make the best wrong answers; other key terms fill in when there are few.
    const exclude = (term) => containsText(question, term);
    const definedTerms = context.pool.filter((entry) => entry.definition).map((entry) => entry.display);
    const wrong = pickSimilar(answer, definedTerms, { level, random, exclude })
      || pickSimilar(answer, context.pool.map((entry) => entry.display), { level, random, exclude });
    return wrong && { kind: "term", question, answer, wrong: wrong.map(capitalize) };
  },

  definition(sentence, context, level, random) {
    const found = sentence.definition;
    if (!found) return null;
    const others = context.definitions
      .filter((item) => comparableText(item.term) !== comparableText(found.term) && !containsText(item.definition, found.term))
      .map((item) => capitalize(item.definition));
    const answer = capitalize(found.definition);
    const wrong = pickSimilar(answer, others, { level, random });
    // Keep the article the source used ("the cell membrane", "an enzyme") so the question reads naturally.
    const entry = context.glossary.get(found.term.toLowerCase());
    const name = entry?.display || found.term;
    const article = sentence.text.match(new RegExp(`^(a|an|the)\\s+${found.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"))?.[1]?.toLowerCase();
    return wrong && { kind: "definition", question: `Which of the following best describes ${article ? `${article} ` : ""}${name}?`, answer, wrong };
  },

  cloze(sentence, context, level, random) {
    if (!sentence.keyTerms.length) return null;
    const position = level === "Easy" ? 0 : level === "Moderate" ? Math.min(1, sentence.keyTerms.length - 1) : sentence.keyTerms.length - 1;
    const term = sentence.keyTerms[position];
    const start = sentence.text.toLowerCase().indexOf(term.key);
    if (start < 0) return null;
    const answer = sentence.text.slice(start, start + term.key.length);
    const wrong = pickSimilar(answer, context.pool.map((entry) => entry.display), {
      level,
      random,
      exclude: (candidate) => sentenceKey(sentence).includes(comparableText(candidate)),
    });
    return wrong && {
      kind: "cloze",
      question: `Which term best completes the statement? "${blank(sentence.text, start, start + answer.length)}"`,
      answer,
      wrong: wrong.map((item) => matchCase(item, answer)),
    };
  },

  number(sentence, context, level, random) {
    const found = sentence.numbers[0];
    if (!found) return null;
    const value = Number(found.value);
    const decimals = found.value.includes(".") ? found.value.split(".")[1].length : 0;
    const isYear = !decimals && value >= 1000 && value <= 2100;
    const offsets = isYear
      ? [-10, 10, -25, 5, -5, 20, -50, 15]
      : decimals
        ? [value * 0.5, value * 1.5, value + 1, value * 2, value - 1].map((item) => item - value)
        : value <= 10
          ? [1, 2, -1, 3, value, 5]
          : [Math.round(value * 0.5) - value, Math.round(value * 0.5), 10, -10, value, 5, -5];
    const answer = `${found.value}${found.suffix}`;
    const options = shuffled(offsets, random)
      .map((offset) => value + offset)
      .filter((item) => item > 0 && item !== value)
      .map((item) => `${decimals ? item.toFixed(decimals) : Math.round(item)}${found.suffix}`)
      .filter((item, index, list) => list.indexOf(item) === index && item !== answer && !sentence.text.includes(item.replace(found.suffix, "")));
    if (options.length < WRONG_CHOICES) return null;
    return {
      kind: "number",
      question: `Which value correctly completes the statement? "${blank(sentence.text, found.start, found.start + answer.length + (found.suffix && sentence.text[found.start + found.value.length] === " " ? 1 : 0))}"`,
      answer,
      wrong: options.slice(0, WRONG_CHOICES),
    };
  },

  // The stem names the page, so there is at most one statement question per page.
  statement(sentence, context, level, random) {
    const question = `Which statement is correct according to page ${sentence.page}?`;
    const term = sentence.keyTerms.find((item) => item.key.length >= 4);
    if (!term || context.avoid.has(comparableText(question))) return null;
    const start = sentence.text.toLowerCase().indexOf(term.key);
    const surface = sentence.text.slice(start, start + term.key.length);
    const replacements = pickSimilar(surface, context.pool.map((entry) => entry.display), {
      level,
      random,
      exclude: (candidate) => {
        if (sentenceKey(sentence).includes(comparableText(candidate))) return true;
        const altered = `${sentence.text.slice(0, start)}${matchCase(candidate, surface)}${sentence.text.slice(start + surface.length)}`;
        return context.allText.includes(comparableText(altered));
      },
    });
    if (!replacements) return null;
    return {
      kind: "statement",
      question,
      answer: sentence.text,
      wrong: replacements.map((candidate) => `${sentence.text.slice(0, start)}${matchCase(candidate, surface)}${sentence.text.slice(start + surface.length)}`),
    };
  },
};

function finish(built, sentence, difficulty, random) {
  const values = [built.answer, ...built.wrong];
  if (built.question.length > MAX_QUESTION_TEXT_LENGTH || values.some((value) => !value || value.length > MAX_CHOICE_TEXT_LENGTH)) return null;
  if (new Set(values.map(comparableText)).size !== CHOICE_KEYS.length) return null;
  const ordered = {
    choices: Object.fromEntries(CHOICE_KEYS.map((key, index) => [key, values[index]])),
    correct: CHOICE_KEYS[0],
  };
  const { choices, correct } = shuffleChoices(ordered, random);
  return {
    kind: built.kind,
    question: built.question,
    choices,
    correct,
    difficulty,
    explanation: `From page ${sentence.page}: "${sentence.text}"`,
    sourcePage: sentence.page,
    evidence: sentence.text,
  };
}

// Interleaves pages so questions are spread across the whole document; within a page the most useful
// sentences come first, with a seeded jitter so regenerating gives a different selection.
function orderSentences(sentences, random) {
  const byPage = new Map();
  for (const sentence of sentences) {
    const list = byPage.get(sentence.page) || [];
    list.push({ sentence, rank: sentence.score + random() * 2.5 });
    byPage.set(sentence.page, list);
  }
  const queues = [...byPage.values()].map((list) => list.sort((left, right) => right.rank - left.rank).map((item) => item.sentence));
  const ordered = [];
  for (let round = 0; queues.some((queue) => round < queue.length); round += 1) {
    for (const queue of queues) if (round < queue.length) ordered.push(queue[round]);
  }
  return ordered;
}

function rotate(list, steps) {
  const offset = steps % list.length;
  return [...list.slice(offset), ...list.slice(0, offset)];
}

export function generateQuestions({ pages, count, difficulty, avoidStems = [], seed = 0 }) {
  const random = createRandom(`questions:${seed}`);
  const avoid = new Set(avoidStems.map(comparableText));
  const context = { ...analyse(pages), avoid };
  const ordered = orderSentences(context.sentences, random);
  const usedSentences = new Set();
  const usedAnswers = new Set();
  const levelUses = { Easy: 0, Moderate: 0, Hard: 0 };
  const questions = [];
  let cursor = 0;

  for (let slot = 0; slot < count; slot += 1) {
    const level = difficulty === "Mixed" ? QUESTION_DIFFICULTIES[slot % QUESTION_DIFFICULTIES.length] : difficulty;
    const preferred = rotate(KINDS_BY_LEVEL[level], levelUses[level]);
    let picked = null;
    for (const kinds of [preferred, ALL_KINDS]) {
      for (const kind of kinds) {
        for (let step = 0; step < ordered.length && !picked; step += 1) {
          const index = (cursor + step) % ordered.length;
          const sentence = ordered[index];
          if (usedSentences.has(sentence)) continue;
          const built = builders[kind](sentence, context, level, random);
          if (!built || avoid.has(comparableText(built.question)) || usedAnswers.has(comparableText(built.answer))) continue;
          const question = finish(built, sentence, level, random);
          if (question) picked = { question, sentence, index };
        }
        if (picked) break;
      }
      if (picked) break;
    }
    if (!picked) break;
    questions.push(picked.question);
    usedSentences.add(picked.sentence);
    usedAnswers.add(comparableText(picked.question.choices[picked.question.correct]));
    avoid.add(comparableText(picked.question.question));
    levelUses[level] += 1;
    cursor = picked.index + 1;
  }
  return questions;
}

// Yields to the browser first so the progress message paints before the work starts.
export async function generateQuestionsInBrowser({ signal, ...options }) {
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  if (signal?.aborted) throw new globalThis.DOMException("Generation was cancelled.", "AbortError");
  return { questions: generateQuestions(options) };
}
