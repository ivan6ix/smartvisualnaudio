import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function jsxFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? jsxFiles(path) : path.endsWith(".jsx") ? [path] : [];
  });
}

// Every modal backdrop (drawer navigation backdrops excluded) must close its modal when clicked.
const missing = [];
let backdrops = 0;
for (const file of jsxFiles("src")) {
  readFileSync(file, "utf8").split("\n").forEach((line, index) => {
    if (!/<div\b[^>]*className="[^"]*backdrop[^"]*"/.test(line) || /drawer/.test(line)) return;
    backdrops += 1;
    if (!/\bonClick=/.test(line)) missing.push(`${file}:${index + 1}`);
  });
}
assert.ok(backdrops >= 30, "Expected to find the application's modal backdrops.");
assert.deepEqual(missing, [], `Modal backdrops without an outside-click handler: ${missing.join(", ")}`);

// The native sign-in dialog closes when its ::backdrop is clicked, but not when its padding is clicked.
const signIn = readFileSync("src/components/landing/SignInDialog.jsx", "utf8");
assert.match(signIn, /onClick=\{closeOnBackdropClick\}/, "Sign-in dialog must close on a backdrop click.");
assert.match(signIn, /event\.target !== event\.currentTarget\) return;[\s\S]*event\.clientX < box\.left \|\| event\.clientX > box\.right \|\| event\.clientY < box\.top \|\| event\.clientY > box\.bottom/, "Sign-in dialog must ignore clicks inside its own box.");

// Portal pages' cards use backdrop-filter, which would confine a fixed backdrop to the card.
const sessions = readFileSync("src/components/ActiveSessions.jsx", "utf8");
assert.match(sessions, /createPortal\(\s*<div className="session-confirm-backdrop"[\s\S]*document\.body/, "Session confirmation must render in a body portal so its backdrop covers the page.");

// Course confirmations ignore backdrop clicks only while their action is running.
const courses = readFileSync("src/pages/Courses.jsx", "utf8");
for (const [name, busy] of [["archiveCandidate", "archiveActionId"], ["restoreCandidate", "archiveActionId"], ["deleteCandidate", "deletingCourseId"]]) {
  assert.match(courses, new RegExp(`\\{${name} \\? \\(\\s*<div className="modal-backdrop" onClick=\\{\\(event\\) => \\{ if \\(event\\.target === event\\.currentTarget && ${busy} !== ${name}\\.id\\)`), `${name} modal must close on an outside click when idle.`);
}

// Exam lock overlays are not dismissible.
const exam = readFileSync("src/pages/student/StudentExamTake.jsx", "utf8");
assert.doesNotMatch(exam, /student-(microphone-lock|exam-lock)-overlay[^\n]*onClick/, "Exam lock overlays must not close on click.");
