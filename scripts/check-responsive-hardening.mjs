import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const examPage = readFileSync(new URL("../src/pages/student/StudentExamTake.jsx", import.meta.url), "utf8");
const roleLayouts = [
  "../src/components/AppShell.jsx",
  "../src/pages/professor/ProfessorLayout.jsx",
  "../src/pages/student/StudentLayout.jsx",
  "../src/pages/dean/DeanLayout.jsx",
  "../src/pages/cluster/ClusterLayout.jsx",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));

[
  "Feature #11 responsive hardening",
  ".student-exam-compatibility-card",
  ".student-exam-compatibility-list",
  ".student-proctor-dock",
  ".student-camera-frame",
  ".student-matching-board",
  "@media screen and (max-width: 700px)",
  "max-height: calc(100dvh - 24px)",
  "overflow-x: auto",
].forEach((token) => assert.ok(css.includes(token), `Missing responsive CSS token: ${token}`));

assert.match(css, /\.list-card-grid,\s*\.list-card-grid\.compact,\s*\.list-card-grid\.dense\s*{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
assert.match(css, /\.student-matching-lines\s*{[\s\S]*display:\s*none/);
assert.match(css, /\.student-exam-take-page\.with-proctor-dock\s*{[\s\S]*padding-bottom:\s*calc\(min\(48dvh,\s*360px\) \+ 32px\)/);

assert.ok(examPage.includes("buildExamCompatibilityResult"), "Student exam page must use capability compatibility helper.");
assert.ok(examPage.includes("!examCompatibility.supported"), "Student exam page must block unsupported required capabilities.");
assert.ok(examPage.includes("Permission prompts, if shown by a supported browser"), "Compatibility copy must distinguish unsupported APIs from permissions.");

roleLayouts.forEach((layout, index) => {
  assert.ok(layout.includes("drawerThemeAction"), `Role layout ${index + 1} must pass a drawer theme action to its sidebar.`);
  assert.ok(layout.includes("admin-sidebar-theme"), `Role layout ${index + 1} must render the mobile drawer theme control.`);
});

assert.match(css, /\.admin-sidebar-theme\s*\{[\s\S]*display:\s*none/, "Drawer theme control should be hidden by default on desktop.");
assert.match(css, /@media screen and \(max-width: 700px\)[\s\S]*\.admin-drawer \.admin-sidebar-theme\s*\{[\s\S]*display:\s*flex/, "Drawer theme control should be available in mobile drawers.");
assert.match(css, /@media screen and \(max-width: 700px\)[\s\S]*\.admin-topbar-actions \.admin-icon-button[^{]*\{[\s\S]*display:\s*none/, "Topbar theme button should move out of the mobile topbar.");
