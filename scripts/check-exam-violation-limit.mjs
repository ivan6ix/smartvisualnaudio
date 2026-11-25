/* global console */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { transformSync } from 'esbuild';
import * as grading from '../src/lib/examQuestionTypes.js';
import * as microphoneSignal from '../src/lib/microphoneSignal.js';
import * as policy from '../src/lib/examViolationLimit.js';
import * as pagination from '../src/lib/examPagination.js';
import * as violationQuestions from '../src/lib/violationQuestions.js';

const original = fs.readFileSync('src/pages/student/StudentExamTake.jsx', 'utf8');
const expose = `return { handleSubmit, acceptRecordedViolation, recordManualViolation, processFaceState, setAnswer, setFileAnswer,
  setExam, setQuestions, setScanStatus, setProgressReady, setStartedAt, setExamModeReady,
  answersRef, filesRef, violationsRef, startedAtRef, examModeReadyRef,
  examSubmittingRef, examSubmittedRef, submissionSnapshotRef, proctorStreamRef, incidentTrackerRef,
  touchedAnswersRef, existingAttemptCount, progressReady, submissionError,
  goToQuestion, currentIndex, currentIndexRef, currentQuestionRef, saveCurrentProgress, unansweredPrompt, confirmUnansweredSubmit, cancelUnansweredSubmit };`;
const code = transformSync(original.replace(/^import[\s\S]*?from\s*"[^"]*";\r?\n/gm, '').replace('export default function StudentExamTake', 'function StudentExamTake').replace('  if (!hasSupabaseConfig) return <PageHeader', `  ${expose}\n  if (!hasSupabaseConfig) return <PageHeader`), {
  loader: 'jsx', jsxFactory: 'h', define: { 'import.meta.env': '{}' },
}).code;
const toasts = [];
const questions = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, question_type: 'Multiple Choice', points: 10, correct_answer: 'A' }));
function harness({ restored = null, storedViolations = [], submitted = false, failAnswers = false } = {}) {
  const slots = [], effects = [], rows = { attempts: [], answers: [], violations: [] }, storage = new Map();
  if (restored) storage.set('smart-proctoring-exam-progress:student:exam', JSON.stringify(restored));
  let cursor = 0, mediaStops = 0, monitorStops = 0, navigated = null;
  const queries = [];
  const supabase = {
    // Submission goes through the submit_exam_attempt RPC; the fake records the payload the page sent.
    async rpc(name, args) {
      if (name === 'get_student_exam_questions') return { data: questions };
      assert.equal(name, 'submit_exam_attempt');
      if (failAnswers) return { error: { message: 'Offline' } };
      rows.attempts.push({ answers: args.p_answers, violations: args.p_violations }); return { error: null };
    },
    from(table) {
    let operation = 'select', payload, filters = [];
    const chain = {
      select() { return chain; }, eq(...args) { filters.push(['eq', ...args]); return chain; }, gte(...args) { filters.push(['gte', ...args]); return chain; },
      order() { return chain; }, limit() { return chain; },
      insert(value) { operation = 'insert'; payload = value; return chain; }, update(value) { operation = 'update'; payload = value; return chain; }, delete() { operation = 'delete'; return chain; },
      single() { return chain; }, maybeSingle() { return chain; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        queries.push({ table, operation, filters });
        if (table === 'exams') return { data: { id: 'exam', exam_settings: { requireEnvironmentScan: false, captureSnapshots: false } } };
        if (table === 'exam_questions') return { data: questions };
        if (table === 'exam_student_access_exceptions') return { data: [] };
        if (table === 'exam_start_sessions') return { data: null };
        if (table === 'violations') {
          if (operation === 'insert') { rows.violations.push(payload); return { data: { id: `v${rows.violations.length}` } }; }
          return { data: storedViolations };
        }
        if (table === 'exam_attempts') {
          if (operation === 'insert') { rows.attempts.push(payload); return { data: { id: 'attempt' } }; }
          if (operation === 'delete') { rows.attempts.pop(); return {}; }
          return { count: submitted ? 1 : 0 };
        }
        if (table === 'exam_attempt_answers') {
          if (failAnswers) return { error: { message: 'Offline' } };
          rows.answers.push(...payload); return {};
        }
        throw new Error('Unexpected query: ' + table);
      }).then(resolve, reject); },
    };
    return chain;
  } };
  const window = { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, document: {}, console,
    clearInterval() {}, clearTimeout() {}, navigator: {},
    confirm() { throw new Error('The exam page must not open a native dialog.'); } };
  const deps = {
    ...grading, ...policy, ...pagination, ...violationQuestions, supabase, hasSupabaseConfig: true, window,
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(value) { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i]; },
    useMemo: fn => fn(), useEffect: fn => effects.push(fn),
    useAuth: () => ({ user: { id: 'student' } }), useParams: () => ({ examId: 'exam' }), useNavigate: () => route => { navigated = route; },
    useLiveAudioMonitoring: () => ({ stop() { monitorStops++; } }), toast: { warning(message) { toasts.push(message); }, error() {}, success() {} },
  };
  // Names imported from modules the harness does not model (icons, scan helpers, components) resolve to inert stubs.
  const stub = new Proxy(function () { return stub; }, { get: (_, key) => key === 'then' ? undefined : key === Symbol.toPrimitive ? () => 'stub' : stub, apply: () => stub });
  const stubs = new Proxy({}, { has: (_, key) => typeof key === 'string' && !(key in deps) && !(key in globalThis), get: (_, key) => key === Symbol.unscopables ? undefined : stub });
  const Component = new Function('stubs', ...Object.keys(deps), 'with (stubs) {' + code + '\nreturn StudentExamTake; }')(stubs, ...Object.values(deps));
  const render = () => { cursor = 0; effects.length = 0; return Component(); };
  let api = render();
  const mount = () => { api.setExam({ id: 'exam', exam_settings: { requireEnvironmentScan: false, captureSnapshots: false } }); api.setQuestions(questions); api.setScanStatus('passed'); api.setProgressReady(true); api.setStartedAt('2026-01-01T00:00:00Z'); api.startedAtRef.current = '2026-01-01T00:00:00Z'; api.examModeReadyRef.current = true; api.setExamModeReady(true); api.proctorStreamRef.current = { getTracks: () => [{ stop() { mediaStops++; } }] }; api = render(); return api; };
  return { render, mount, load: async () => { effects[0](); await settle(); return render(); }, rows, queries, storage, setFail: value => { failAnswers = value; }, stats: () => ({ mediaStops, monitorStops, navigated }) };
}
async function settle() { for (let i = 0; i < 12; i++) await setImmediate(); }
const event = (index, type = `TEST_${index}`) => ({ id: `id${index}`, type, message: type, severity: 'High', timestamp: `2026-01-01T00:00:${String(index).padStart(2, '0')}Z` });

const h = harness(); let api = h.mount();
for (let i = 0; i < 6; i++) api.setAnswer(`q${i}`, 'A');
for (let i = 1; i <= 8; i++) assert.equal(api.acceptRecordedViolation(event(i)), false);
await settle();
assert.equal(h.rows.attempts.length, 0, 'Violations must never auto-submit the exam');
api.setAnswer('q6', 'A'); assert.equal(api.answersRef.current.q6, 'A');
await Promise.all([api.confirmUnansweredSubmit(), api.handleSubmit('timer')]);
await settle();
assert.equal(h.rows.attempts.length, 1);
assert.equal(h.rows.attempts[0].violations.length, 8);
assert.equal(Object.values(h.rows.attempts[0].answers).filter(answer => answer === null).length, 3);
assert.equal(h.rows.attempts[0].answers.q6, 'A');
assert.equal(h.stats().mediaStops, 1); assert.equal(h.stats().navigated, '/student/grades');
assert.equal(api.examModeReadyRef.current, false);

const concurrent = harness(); api = concurrent.mount();
for (let i = 1; i <= 4; i++) api.acceptRecordedViolation(event(i));
api.recordManualViolation('MULTIPLE_FACE', 'Multiple faces'); api.recordManualViolation('TAB_SWITCH', 'Hidden');
await settle(); assert.equal(concurrent.rows.attempts.length, 0);
await Promise.all([api.confirmUnansweredSubmit(), api.confirmUnansweredSubmit()]); await settle(); assert.equal(concurrent.rows.attempts.length, 1);

const tracker = policy.createIncidentTracker();
assert.equal(tracker.claim('NO_FACE'), true);
for (let i = 0; i < 20; i++) assert.equal(tracker.claim('NO_FACE'), false);
tracker.clear('NO_FACE'); assert.equal(tracker.claim('NO_FACE'), true);
assert.equal(tracker.claim('COPY_ATTEMPT', 100), true); assert.equal(tracker.claim('COPY_ATTEMPT', 101), false);

const saved = { startedAt: '2026-01-01T00:00:00Z', scanStatus: 'passed', answers: { q0: 'A' }, violations: [event(1)] };
const persisted = [1, 2, 3].map(i => ({ id: `id${i}`, violation_type: `TEST_${i}`, created_at: event(i).timestamp, severity: 'High' }));
const resume = harness({ restored: saved, storedViolations: persisted }); api = await resume.load();
assert.equal(api.violationsRef.current.length, 3);
assert.deepEqual(resume.queries.find(q => q.table === 'violations').filters, [['eq', 'student_id', 'student'], ['eq', 'exam_id', 'exam'], ['gte', 'created_at', saved.startedAt]]);
const reached = harness({ restored: { ...saved, violations: [1,2,3,4,5].map(i => event(i)) } }); api = await reached.load();
assert.equal(api.violationsRef.current.length, 5); await settle(); assert.equal(reached.rows.attempts.length, 0);
const completed = harness({ restored: saved, submitted: true }); api = await completed.load(); assert.equal(api.existingAttemptCount, 1);
const fresh = harness(); api = fresh.mount(); assert.equal(api.violationsRef.current.length, 0);

const retry = harness({ failAnswers: true }); api = retry.mount(); api.setAnswer('q0', 'A');
for (let i = 1; i <= 5; i++) api.acceptRecordedViolation(event(i));
await settle(); assert.equal(retry.rows.attempts.length, 0);
await api.confirmUnansweredSubmit(); assert.equal(retry.rows.attempts.length, 0); assert.equal(api.examSubmittingRef.current, false);
api.setAnswer('q1', 'A'); retry.setFail(false); await api.confirmUnansweredSubmit();
assert.equal(retry.rows.attempts.length, 1); assert.equal(retry.rows.attempts[0].answers.q1, 'A');

const manual = harness(); api = manual.mount();
api.setQuestions([{ id: 'essay', question_type: 'Essay', points: 10 }, { id: 'empty', question_type: 'Essay', points: 10 }, { id: 'order', question_type: 'Ordering / Sequencing', points: 10, correct_answers: ['a','b'] }]);
api = manual.render(); api.setAnswer('essay', 'My response'); api.answersRef.current.order = ['a','b'];
await api.confirmUnansweredSubmit();
assert.equal(manual.rows.attempts[0].answers.essay, 'My response');
for (const id of ['empty','order']) assert.equal(manual.rows.attempts[0].answers[id], null);
assert.doesNotMatch(original, /EXAM_VIOLATION_LIMIT|violationLimitReachedRef|"violation_limit"/, 'No violation limit remains on the exam page.');
assert.doesNotMatch(fs.readFileSync('src/services/audioViolationService.js', 'utf8'), /violation limit|limitReached/);
assert.doesNotMatch(fs.readFileSync('src/components/landing/content.js', 'utf8'), /violation limit/);
assert.equal(policy.EXAM_VIOLATION_LIMIT, undefined);
// Pagination: the ref names the question on screen, the page survives a reload, and only a manual submit asks.
const paged = harness(); api = paged.mount();
api.goToQuestion(3); api = paged.render();
assert.equal(api.currentIndex, 3); assert.deepEqual(api.currentQuestionRef.current, { questionId: 'q3', screenNumber: 4 });
api.goToQuestion(99); assert.deepEqual(api.currentQuestionRef.current, { questionId: 'q9', screenNumber: 10 });
api.goToQuestion(-5); assert.deepEqual(api.currentQuestionRef.current, { questionId: 'q0', screenNumber: 1 });
api.goToQuestion(6); assert.equal(api.saveCurrentProgress().currentIndex, 6);
const firstLoad = harness(); api = await firstLoad.load();
assert.deepEqual(api.currentQuestionRef.current, { questionId: 'q0', screenNumber: 1 }, 'A first load opens question 1.');
const reopened = harness({ restored: { ...saved, currentIndex: 7 } }); api = await reopened.load();
assert.equal(api.currentIndex, 7); assert.deepEqual(api.currentQuestionRef.current, { questionId: 'q7', screenNumber: 8 });
const outOfRange = harness({ restored: { ...saved, currentIndex: 40 } }); api = await outOfRange.load();
assert.deepEqual(api.currentQuestionRef.current, { questionId: 'q9', screenNumber: 10 }, 'A saved page past the end is clamped.');
// A violation records the question on screen: the professor's number (unshuffled order) goes to the table,
// the student's screen number goes to the notice. Here the saved order shows the questions reversed.
const reversedOrder = { questionIds: questions.map(q => q.id).reverse() };
const tagged = harness({ restored: { ...saved, violations: [], currentIndex: 0, questionOrder: reversedOrder } }); api = await tagged.load();
api.examModeReadyRef.current = true; toasts.length = 0;
assert.deepEqual(api.currentQuestionRef.current, { questionId: 'q9', screenNumber: 1 });
api.recordManualViolation('TAB_SWITCH', 'The exam tab was hidden.'); await settle(); api = tagged.render();
const taggedRow = tagged.rows.violations.at(-1);
assert.equal(taggedRow.question_id, 'q9'); assert.equal(taggedRow.question_number, 10, 'The table gets the professor\'s number, not the screen number.');
assert.equal(api.violationsRef.current.at(-1).questionNumber, 10); assert.equal(api.violationsRef.current.at(-1).screenNumber, 1);
assert.equal(toasts.at(-1), "The exam tab was hidden on question 1. It is recorded for your professor's review.");
api.goToQuestion(4); api.recordManualViolation('COPY_ATTEMPT', 'Copy attempt'); await settle();
assert.equal(tagged.rows.violations.at(-1).question_id, 'q5'); assert.equal(tagged.rows.violations.at(-1).question_number, 6);
// Before any question is loaded there is no question to record.
const early = harness(); api = early.mount(); api.recordManualViolation('TAB_SWITCH', 'Hidden'); await settle();
assert.equal(early.rows.violations.at(-1).question_id, null); assert.equal(early.rows.violations.at(-1).question_number, null);
// The unanswered prompt is in-page (the fake window.confirm throws), and opening it records nothing.
assert.doesNotMatch(original, /window\.confirm/, 'The exam page never opens a native dialog.');
assert.match(original, /role="alertdialog"[\s\S]*?Go back[\s\S]*?Submit anyway/, 'The prompt offers Go back and Submit anyway.');
const declined = harness(); api = declined.mount();
for (let i = 0; i < 8; i++) api.setAnswer(`q${i}`, 'A');
await api.handleSubmit('manual'); await settle(); api = declined.render();
assert.equal(api.unansweredPrompt, 'Questions 9 and 10 are unanswered. Submit anyway?');
assert.equal(declined.rows.attempts.length, 0, 'Opening the prompt submits nothing.');
assert.equal(api.examSubmittingRef.current, false);
assert.equal(declined.rows.violations.length, 0, 'No violation is recorded while the prompt is open.'); assert.equal(api.violationsRef.current.length, 0);
api.cancelUnansweredSubmit(); await settle(); api = declined.render();
assert.equal(api.unansweredPrompt, '', 'Go back closes the prompt.');
assert.equal(declined.rows.attempts.length, 0, 'Go back submits nothing.'); assert.equal(declined.rows.violations.length, 0);
await api.handleSubmit('timer'); await settle(); api = declined.render();
assert.equal(api.unansweredPrompt, '', 'The timer submits without asking.'); assert.equal(declined.rows.attempts.length, 1);
const accepted = harness(); api = accepted.mount();
await api.handleSubmit('manual'); await settle(); api = accepted.render();
assert.equal(api.unansweredPrompt, 'Questions 1, 2, 3, 4, 5, 6, 7, 8, 9 and 10 are unanswered. Submit anyway?');
assert.equal(accepted.rows.attempts.length, 0);
await api.confirmUnansweredSubmit(); await settle(); api = accepted.render();
assert.equal(accepted.rows.attempts.length, 1, 'Submit anyway submits once.'); assert.equal(api.unansweredPrompt, '');
assert.equal(accepted.rows.violations.length, 0);
const complete = harness(); api = complete.mount();
for (let i = 0; i < 10; i++) api.setAnswer(`q${i}`, 'A');
await api.handleSubmit('manual'); await settle(); api = complete.render();
assert.equal(api.unansweredPrompt, '', 'No prompt when every question is answered.'); assert.equal(complete.rows.attempts.length, 1);
const interrupted = harness(); api = interrupted.mount();
await api.handleSubmit('interruption_limit'); await settle(); api = interrupted.render();
assert.equal(api.unansweredPrompt, '', 'The interruption limit never asks.'); assert.equal(interrupted.rows.attempts.length, 1);

console.log('Passed unlimited violations, concurrent submit guards, persistence restore, incident deduplication, retry locking, unanswered scoring, manual grading, pagination, in-page unanswered confirmation, and media cleanup checks.');

// Run the real audio hook against a deterministic analyser/animation clock.
const audioSource = fs.readFileSync('src/hooks/useLiveAudioMonitoring.js', 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export function useLiveAudioMonitoring', 'function useLiveAudioMonitoring');
let now = 100000, frame = null, loud = true, audioCount = 0, monitoring;
class Clock extends Date { static now() { return now; } }
const fakeWindow = {
  console, MediaStream: class { constructor(tracks) { this.tracks = tracks; } getAudioTracks() { return this.tracks; } },
  AudioContext: class {
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { getByteTimeDomainData(samples) { samples.fill(loud ? 140 : 129); } }; }
    resume() {} close() {}
  },
  requestAnimationFrame(callback) { frame = callback; return 1; }, cancelAnimationFrame() { frame = null; },
};
const audioDeps = {
  ...microphoneSignal, window: fakeWindow, Date: Clock,
  useState: value => [value, () => {}], useRef: value => ({ current: value }), useCallback: fn => fn, useEffect() {},
  uploadAudioViolation: async ({ onRecorded }) => onRecorded({ violationId: `audio-${audioCount}` }),
};
const hook = new Function(...Object.keys(audioDeps), audioSource + '\nreturn useLiveAudioMonitoring;')(...Object.values(audioDeps));
monitoring = hook({ enabled: true, exam: { id: 'exam' }, student: { id: 'student' }, canRecordViolation: () => true, onViolation: () => { audioCount++; if (audioCount === 5) monitoring.stop(); } });
monitoring.start({ getAudioTracks: () => [{}] });
async function audioTicks(count) { for (let i = 0; i < count; i++) { now += 1000; const callback = frame; frame = null; callback?.(); await settle(); } }
await audioTicks(30); assert.equal(audioCount, 1, 'Continuous loud sound must count only once');
for (let i = 0; i < 4; i++) { loud = false; await audioTicks(3); loud = true; await audioTicks(5); }
assert.equal(audioCount, 5); assert.equal(frame, null, 'Cutoff must not reschedule audio monitoring');
// The question is captured when loud audio triggers, sent with the upload, and handed to the page for its notice.
let uploadArgs = null, handed = null, onScreen = { question_id: 'q4', question_number: 7, screenNumber: 2 };
const questionHook = new Function(...Object.keys(audioDeps), audioSource + '\nreturn useLiveAudioMonitoring;')(...Object.values({
  ...audioDeps, uploadAudioViolation: async (args) => { uploadArgs = args; onScreen = { question_id: 'q5', question_number: 8, screenNumber: 3 }; args.onRecorded({ violationId: 'audio-q' }); },
}));
loud = true; frame = null;
monitoring = questionHook({ enabled: true, exam: { id: 'exam' }, student: { id: 'student' }, canRecordViolation: () => true, getQuestionContext: () => onScreen, onViolation: (violation) => { handed = violation; monitoring.stop(); } });
monitoring.start({ getAudioTracks: () => [{}] });
await audioTicks(6);
assert.deepEqual(uploadArgs.questionContext, { question_id: 'q4', question_number: 7, screenNumber: 2 }, 'The upload gets the question on screen at the trigger.');
assert.equal(handed.questionNumber, 7); assert.equal(handed.screenNumber, 2);
console.log('Passed audio incident rearming, cutoff cleanup and question capture checks.');
