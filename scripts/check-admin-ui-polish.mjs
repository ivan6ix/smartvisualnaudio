import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const dashboard = readFileSync(new URL("../src/pages/Dashboard.jsx", import.meta.url), "utf8");
const appShell = readFileSync(new URL("../src/components/AppShell.jsx", import.meta.url), "utf8");
const people = readFileSync(new URL("../src/pages/People.jsx", import.meta.url), "utf8");
const accounts = readFileSync(new URL("../src/pages/Accounts.jsx", import.meta.url), "utf8");
const adminLogs = readFileSync(new URL("../src/pages/AdminLogs.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

assert.ok(!dashboard.includes("Active Exams</span>"), "Admin dashboard should remove the Active Exams panel.");
assert.ok(!dashboard.includes("Quick Actions</span>"), "Admin dashboard should remove the Quick Actions panel.");
assert.equal((dashboard.match(/System Health/g) || []).length, 1, "System Health should render once.");
assert.ok(dashboard.indexOf("Violation Analytics") < dashboard.indexOf("System Health"), "System Health should sit beside/after Violation Analytics.");
assert.ok(dashboard.indexOf("System Health") < dashboard.indexOf("Recent Account Activity"), "Recent activity should follow System Health.");
// Storage RLS hides the bucket list from signed-in users, so a bucket count would always read 0.
assert.ok(!/buckets`|\.length} buckets/.test(dashboard), "System Health must not show a bucket count.");
assert.match(dashboard, /storage: storageError \? "Unavailable" : "Online"/, "Storage health must show whether the service answers.");
assert.match(dashboard, /<strong>Storage Status<\/strong>/);
assert.match(dashboard, /\["Total Violations", liveStats\.totalViolations, FiActivity\]/, "Admin dashboard must show Total Violations.");
assert.ok(!dashboard.includes("Violations Today"), "Admin dashboard must not show Violations Today.");
assert.match(dashboard, /countRows\(supabase\.from\("violations"\)\.select\("id", \{ count: "exact", head: true \}\)\)/, "Total Violations must count every violation, with no date filter.");

const themeIndex = appShell.indexOf('title="Theme"');
const messagesIndex = appShell.indexOf("<MessageMenu");
const notificationsIndex = appShell.indexOf("<NotificationBell");
const profileIndex = appShell.indexOf("admin-profile-menu");
assert.ok(themeIndex < messagesIndex && messagesIndex < notificationsIndex && notificationsIndex < profileIndex, "Admin topbar order should be Theme, Messages, Notifications, Profile.");

// Top bar menus open only on click and close on an outside click or Escape.
assert.ok(!/\.(message|notification)-menu:(hover|focus-within) \.(message|notification)-menu-panel/.test(css), "Message and notification menus must not open on hover or focus.");
// A focus rule keeps the panel open after the icon is clicked again, so a second click would not close it.
assert.ok(!/:is\([^)]*(message|notification)-menu[^)]*\):(hover|focus-within)/.test(css), "Message and notification menus must close when the icon is clicked again.");
for (const name of ["MessageMenu", "NotificationBell", "ProfileMenu"]) {
  const source = readFileSync(new URL(`../src/components/${name}.jsx`, import.meta.url), "utf8");
  assert.match(source, /event\.key === "Escape"[\s\S]*document\.addEventListener\("mousedown", handlePointer\)/, `${name} must close on an outside click and on Escape.`);
}
assert.match(css, /\.admin-sidebar-profile > div > span \{/, "Sidebar role text styles must not hit the avatar.");

["admin-account-table", "admin-account-table-active", "admin-account-table-deactivated"].forEach((token) => {
  assert.ok(people.includes(token), `Create Account tables should use ${token}.`);
  assert.ok(accounts.includes(token), `Accounts tables should use ${token}.`);
  assert.ok(css.includes(token), `CSS missing ${token}.`);
});

assert.ok(people.includes("No accounts match your search or filters."), "Create Account filters need a search/filter empty state.");
assert.ok(accounts.includes("No accounts match your search or filters."), "Accounts filters need a search/filter empty state.");
assert.ok(accounts.includes("setActivePage(1)") && accounts.includes("setDeactivatedPage(1)"), "Accounts filters should reset pagination.");

["admin-logs-table", "admin-log-description", "vertical-align: middle"].forEach((token) => {
  assert.ok(css.includes(token) || adminLogs.includes(token), `Logs layout should include ${token}.`);
});
assert.ok(adminLogs.includes('className: "admin-log-description"'), "Logs description column should have a dedicated class.");

[
  ".admin-section-page .admin-section-hero",
  "border-radius: 8px",
  "background: var(--app-surface)",
  ".admin-section-page .admin-stat-card",
  ".admin-section-page .admin-panel",
  ".admin-section-page .toolbar",
  ".admin-section-page .list-view-toolbar",
  ".admin-section-page .table-wrap",
  "contain: inline-size",
  ".admin-section-page .modal",
  ".admin-section-page .btn:not(.btn-light)",
].forEach((token) => {
  assert.ok(css.includes(token), `Admin visual polish missing CSS token: ${token}`);
});

[
  "radial-gradient(circle at 86% 18%",
  "linear-gradient(135deg, #2563eb, #06b6d4)",
  "border-radius: 30px",
  "box-shadow: 0 0 42px",
].forEach((token) => {
  const lateAdminPolish = css.slice(css.lastIndexOf("/* Admin system-wide UI polish"));
  assert.ok(!lateAdminPolish.includes(token), `Final Admin polish should remove decorative token: ${token}`);
});

[
  "@media (max-width: 390px)",
  "@media (max-width: 360px)",
  "@media (max-width: 340px)",
  "grid-template-columns: minmax(0, 1fr)",
].forEach((token) => {
  assert.ok(css.includes(token), `Admin responsive polish missing token: ${token}`);
});

// Archived Courses window: re-balanced columns that fill exactly 100% with the Actions column, wrapping cells,
// and an Actions cell that stays a table cell so Restore and Delete Permanently are not cut off.
const courses = readFileSync(new URL("../src/pages/Courses.jsx", import.meta.url), "utf8");
assert.match(courses, /className="modal archive-courses-modal"/, "Archived Courses must use its own wider window.");
assert.match(courses, /className="archive-management-table" columns=\{archiveColumns\}/, "Archived Courses must use the re-balanced archive columns.");
const archiveWidths = courses.match(/const ARCHIVE_COLUMN_WIDTHS = \{([^}]*)\}/);
const archiveActions = courses.match(/const ARCHIVE_ACTIONS_WIDTH = "(\d+)%"/);
assert.ok(archiveWidths && archiveActions, "Archive column widths must be defined.");
const archiveTotal = [...archiveWidths[1].matchAll(/"(\d+)%"/g)].reduce((sum, match) => sum + Number(match[1]), Number(archiveActions[1]));
assert.equal(archiveTotal, 100, "Archived Courses columns must add up to 100%.");
assert.match(css, /\.admin-section-page \.modal\.archive-courses-modal \{\s*width: min\(1120px, calc\(100vw - 32px\)\);/, "Archived Courses window must be wider than the default admin modal.");
assert.match(css, /\.archive-management-table td \{\s*white-space: normal;\s*overflow-wrap: break-word;/, "Archived Courses cells must wrap instead of overlapping.");
assert.match(css, /\.archive-management-table td\.actions \{[\s\S]*?display: table-cell;\s*min-width: 0;/, "Archived Courses Actions cell must stay a table cell.");
