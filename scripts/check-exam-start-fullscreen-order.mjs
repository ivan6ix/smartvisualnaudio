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
// Leaving the page while fullscreen is pending must not create a start session.
assert.match(start.slice(0, authorizeAt), /if \(!mountedRef\.current\) \{\s*await leavePreStartFullscreen\(\);\s*return;\s*\}/, "An unmounted exam page must not authorize a start.");

// Authorization failure after fullscreen restores the pre-exam screen without a violation.
assert.match(start, /if \(error\) \{\s*await leavePreStartFullscreen\(\);\s*toast\.error\(error\.message\);\s*return;/, "Authorization failure must leave pre-start fullscreen and stay on the introduction.");
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
