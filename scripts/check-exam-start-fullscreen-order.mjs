import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");

function body(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name} must exist.`);
  const next = source.indexOf("\n  async function ", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

const enter = body("enterExamMode");
const start = body("startAuthorizedExamMode");
const restore = body("restoreExamLock");

// Repeated Start clicks share one in-flight start.
assert.match(enter, /if \(examStartInFlightRef\.current\) return;[\s\S]*examStartInFlightRef\.current = true;[\s\S]*finally \{[\s\S]*examStartInFlightRef\.current = false;/, "Start must ignore repeated clicks while a start is in flight.");
assert.match(source, /disabled=\{!scanPassed \|\| attemptsExhausted \|\| examStarting\} onClick=\{enterExamMode\}/, "Start Exam must be disabled while starting.");

// Fullscreen succeeds before any server start is authorized.
const lockAt = start.indexOf("requestExamLock()");
const authorizeAt = start.indexOf('supabase.rpc("authorize_exam_start"');
assert.ok(lockAt >= 0 && authorizeAt > lockAt, "Fullscreen must be entered before authorize_exam_start is called.");
assert.match(start.slice(0, authorizeAt), /if \(!getFullscreenElement\(\)\) throw new Error\("Fullscreen did not start\."\);\s*\} catch \{\s*abandoned = true;\s*toast\.error\("Fullscreen is required[^"]*"\);\s*return;/, "Fullscreen denial or API failure must stop before authorization.");
assert.match(start.slice(0, authorizeAt), /Promise\.race\(\[\s*lock,\s*wait\(FULLSCREEN_START_TIMEOUT_MS\)/, "A fullscreen request that never settles must time out before authorization.");
assert.doesNotMatch(start.slice(0, authorizeAt), /recordManualViolation|recordInterruptionRecovery/, "A refused fullscreen request must not record a violation or interruption.");

// A late fullscreen grant after the timeout returns the intro screen to normal and never authorizes.
assert.match(start.slice(0, authorizeAt), /lock\.then\(\(\) => \{\s*if \(abandoned && !examStartInFlightRef\.current && !examModeReadyRef\.current\) void leavePreStartFullscreen\(\);/, "A fullscreen grant arriving after the timeout must leave pre-start fullscreen.");
assert.match(start.slice(0, authorizeAt), /\} catch \{\s*abandoned = true;/, "A timed-out or refused fullscreen request must be marked abandoned.");
// Leaving the page or abandoning the start must not create a start session.
assert.match(enter, /examStartGenerationRef\.current \+= 1;[\s\S]*startAuthorizedExamMode\(examStartGenerationRef\.current\)/, "Each start must carry its own generation.");
assert.match(start, /const isCurrentStart = \(\) => mountedRef\.current && examStartGenerationRef\.current === generation;/, "Start must check the page is mounted and the start is current.");
assert.match(start.slice(0, authorizeAt), /if \(!isCurrentStart\(\)\) \{\s*await leavePreStartFullscreen\(\);\s*return;\s*\}/, "An unmounted exam page must not authorize a start.");

// Required devices are acquired after fullscreen and before authorization; monitoring starts after it.
const acquireAt = start.indexOf("await acquireProctorStream()");
const activateAt = start.indexOf("activateProctoring(stream)");
assert.ok(acquireAt > lockAt && acquireAt < authorizeAt, "Media must be acquired after fullscreen and before authorize_exam_start.");
assert.ok(activateAt > authorizeAt, "Monitoring must be activated only after authorization.");
assert.match(start.slice(0, authorizeAt), /stream = await acquireProctorStream\(\);\s*\} catch \(mediaError\) \{\s*await leavePreStartFullscreen\(\);\s*if \(isCurrentStart\(\)\) toast\.error\(describeMediaStartError\(mediaError\)\);\s*return;/, "Failed media acquisition must stop before authorization.");
assert.match(start.slice(acquireAt, authorizeAt), /if \(!isCurrentStart\(\)\) \{\s*releaseStream\(\);[\s\S]*if \(!getFullscreenElement\(\)\) \{\s*releaseStream\(\);/, "Late media after an abandoned start, or lost fullscreen, must release tracks without authorizing.");
assert.doesNotMatch(start.slice(0, authorizeAt), /startFaceMonitoring|startObjectMonitoring|startRoboflowMonitoring|audioMonitoring\.start/, "External monitoring must not start before authorization.");
const acquireStart = source.indexOf("async function acquireProctorStream(");
const acquire = source.slice(acquireStart, source.indexOf("\n  }\n", acquireStart) + 4);
assert.match(acquire, /getUserMedia[\s\S]*if \(unusable\) \{\s*stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\);/, "Unusable devices must release the acquired stream.");
assert.doesNotMatch(acquire, /startFaceMonitoring|startObjectMonitoring|startRoboflowMonitoring|audioMonitoring\.start|authorize_exam_start/, "Acquisition must not start monitoring or authorize.");
assert.match(source, /function activateProctoring\(stream\) \{[\s\S]*proctorStreamRef\.current = stream;[\s\S]*startFaceMonitoring\(\);[\s\S]*audioMonitoring\.start\(stream\);/, "Activation must reuse the acquired stream for existing monitoring.");
assert.doesNotMatch(source, /async function startProctorCamera/, "The combined acquire-and-monitor helper must not return.");

// Authorization failure after fullscreen restores the pre-exam screen without a violation.
assert.match(start, /if \(error\) \{\s*releaseStream\(\);\s*await leavePreStartFullscreen\(\);\s*toast\.error\(error\.message\);\s*return;/, "Authorization failure must release devices, leave pre-start fullscreen and stay on the introduction.");
assert.doesNotMatch(start, /recordManualViolation\("FULLSCREEN_EXIT"/, "Exam start must not record a false FULLSCREEN_EXIT violation.");

// Timer and running state begin only after authorization.
const timerAt = start.indexOf("startTimerIfNeeded();");
const readyAt = start.indexOf("examModeReadyRef.current = true;");
assert.ok(timerAt > authorizeAt && readyAt > authorizeAt, "Timer and exam-running state must start after authorization.");
assert.match(start, /if \(!startedAtRef\.current\) startedAtRef\.current = serverStart;/, "Resumed exams must keep the server start time.");

// Resume still goes through interruption recovery and the same guarded start.
assert.match(body("resumeExamMode"), /recordInterruptionRecovery\("saved-progress"[\s\S]*await enterExamMode\(\);/, "Resume must keep interruption recovery before starting.");

// Genuine fullscreen exits during an active exam stay protected.
assert.match(source, /if \(!scanPassed \|\| scanOpen \|\| !examModeReady\) return undefined;[\s\S]*function handleFullscreenChange\(\)[\s\S]*recordGuardViolation\("FULLSCREEN_EXIT"/, "Active exams must still record fullscreen exits.");
assert.match(restore, /recordManualViolation\("FULLSCREEN_EXIT"/, "Failing to restore fullscreen during an exam must still record a violation.");
