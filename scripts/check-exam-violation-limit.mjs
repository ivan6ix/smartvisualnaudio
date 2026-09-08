/* global console */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { transformSync } from 'esbuild';
import * as grading from '../src/lib/examQuestionTypes.js';
import * as policy from '../src/lib/examViolationLimit.js';

const original = fs.readFileSync('src/pages/student/StudentExamTake.jsx', 'utf8');
const expose = `return { handleSubmit, acceptRecordedViolation, recordManualViolation, processFaceState, setAnswer, setFileAnswer,
  setExam, setQuestions, setScanStatus, setProgressReady, setStartedAt, setExamModeReady,
  answersRef, filesRef, violationsRef, startedAtRef, examModeReadyRef, violationLimitReachedRef,
  examSubmittingRef, examSubmittedRef, submissionSnapshotRef, proctorStreamRef, incidentTrackerRef,
  touchedAnswersRef, existingAttemptCount, autoSubmitRequired, progressReady, submissionError };`;
const code = transformSync(original.replace(/^import .*;\r?\n/gm, '').replace('export default function StudentExamTake', 'function StudentExamTake').replace('  if (!hasSupabaseConfig) return <PageHeader', `  ${expose}\n  if (!hasSupabaseConfig) return <PageHeader`), {
  loader: 'jsx', jsxFactory: 'h', define: { 'import.meta.env': '{}' },
}).code;
const questions = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, question_type: 'Multiple Choice', points: 10, correct_answer: 'A' }));
function harness({ restored = null, storedViolations = [], submitted = false, failAnswers = false } = {}) {
  const slots = [], effects = [], rows = { attempts: [], answers: [], violations: [] }, storage = new Map();
  if (restored) storage.set('smart-proctoring-exam-progress:student:exam', JSON.stringify(restored));
  let cursor = 0, mediaStops = 0, monitorStops = 0, navigated = null;
  const queries = [];
  const supabase = { from(table) {
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
    clearInterval() {}, clearTimeout() {}, navigator: {} };
  const deps = {
    ...grading, ...policy, supabase, hasSupabaseConfig: true, window,
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(value) { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i]; },
    useMemo: fn => fn(), useEffect: fn => effects.push(fn),
    useAuth: () => ({ user: { id: 'student' } }), useParams: () => ({ examId: 'exam' }), useNavigate: () => route => { navigated = route; },
    useLiveAudioMonitoring: () => ({ stop() { monitorStops++; } }), toast: { warning() {}, error() {}, success() {} },
  };
  const Component = new Function(...Object.keys(deps), code + '\nreturn StudentExamTake;')(...Object.values(deps));
  const render = () => { cursor = 0; effects.length = 0; return Component(); };
  let api = render();
  const mount = () => { api.setExam({ id: 'exam', exam_settings: { requireEnvironmentScan: false, captureSnapshots: false } }); api.setQuestions(questions); api.setScanStatus('passed'); api.setProgressReady(true); api.setStartedAt('2026-01-01T00:00:00Z'); api.startedAtRef.current = '2026-01-01T00:00:00Z'; api.examModeReadyRef.current = true; api.setExamModeReady(true); api.proctorStreamRef.current = { getTracks: () => [{ stop() { mediaStops++; } }] }; api = render(); return api; };
  return { render, mount, load: async () => { effects[0](); await settle(); return render(); }, rows, queries, storage, setFail: value => { failAnswers = value; }, stats: () => ({ mediaStops, monitorStops, navigated }) };
}
async function settle() { for (let i = 0; i < 12; i++) await setImmediate(); }
const event = (index, type = `TEST_${index}`) => ({ id: `id${index}`, type, message: type, severity: 'High', timestamp: `2026-01-01T00:00:${String(index).padStart(2, '0')}Z` });

const h = harness(); let api = h.mount();
for (let i = 0; i < 6; i++) api.setAnswer(`q${i}`, 'A');
for (let i = 1; i <= 4; i++) api.acceptRecordedViolation(event(i));
assert.equal(h.rows.attempts.length, 0);
assert.match(policy.violationWarning(4), /Final warning/);
api.acceptRecordedViolation(event(5));
api.setAnswer('q6', 'A');
await Promise.all([api.handleSubmit('timer'), api.handleSubmit('manual')]);
await settle();
assert.equal(h.rows.attempts.length, 1);
assert.equal(h.rows.attempts[0].score, 60);
assert.equal(h.rows.answers.filter(answer => answer.answer === null).length, 4);
assert.equal(h.rows.answers.filter(answer => answer.earned_points === 0).length, 4);
assert.equal(h.rows.attempts[0].violations[4].submissionReason, 'violation_limit');
assert.equal(h.stats().mediaStops, 1); assert.equal(h.stats().navigated, '/student/grades');
assert.equal(api.examModeReadyRef.current, false);

const concurrent = harness(); api = concurrent.mount();
for (let i = 1; i <= 4; i++) api.acceptRecordedViolation(event(i));
api.recordManualViolation('MULTIPLE_FACE', 'Multiple faces'); api.recordManualViolation('TAB_SWITCH', 'Hidden');
await settle(); assert.equal(concurrent.rows.attempts.length, 1);

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
assert.equal(api.autoSubmitRequired, true); await api.handleSubmit('violation_limit'); assert.equal(reached.rows.attempts.length, 1);
const completed = harness({ restored: saved, submitted: true }); api = await completed.load(); assert.equal(api.existingAttemptCount, 1);
const fresh = harness(); api = fresh.mount(); assert.equal(api.violationsRef.current.length, 0);

const retry = harness({ failAnswers: true }); api = retry.mount(); api.setAnswer('q0', 'A');
for (let i = 1; i <= 5; i++) api.acceptRecordedViolation(event(i));
await settle(); assert.equal(api.violationLimitReachedRef.current, true); assert.equal(api.examSubmittingRef.current, false);
api.setAnswer('q1', 'A'); retry.setFail(false); await api.handleSubmit('violation_limit');
assert.equal(retry.rows.attempts.length, 1); assert.equal(retry.rows.attempts[0].score, 10);

const manual = harness(); api = manual.mount();
api.setQuestions([{ id: 'essay', question_type: 'Essay', points: 10 }, { id: 'empty', question_type: 'Essay', points: 10 }, { id: 'order', question_type: 'Ordering / Sequencing', points: 10, correct_answers: ['a','b'] }]);
api = manual.render(); api.setAnswer('essay', 'My response'); api.answersRef.current.order = ['a','b'];
await api.handleSubmit('manual');
assert.equal(manual.rows.attempts[0].status, 'Pending Manual Grading');
assert.equal(manual.rows.answers.find(a => a.question_id === 'essay').needs_manual_grading, true);
for (const id of ['empty','order']) { const answer = manual.rows.answers.find(a => a.question_id === id); assert.equal(answer.answer, null); assert.equal(answer.earned_points, 0); }
console.log('Passed exam cutoff, concurrent submit guards, persistence restore, incident deduplication, retry locking, unanswered scoring, manual grading, and media cleanup checks.');

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
  window: fakeWindow, Date: Clock,
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
console.log('Passed audio incident rearming and cutoff cleanup checks.');
