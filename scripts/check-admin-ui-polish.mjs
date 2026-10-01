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

const themeIndex = appShell.indexOf('title="Theme"');
const messagesIndex = appShell.indexOf('title="Messages"');
const notificationsIndex = appShell.indexOf("<NotificationBell");
const profileIndex = appShell.indexOf("admin-profile-menu");
assert.ok(themeIndex < messagesIndex && messagesIndex < notificationsIndex && notificationsIndex < profileIndex, "Admin topbar order should be Theme, Messages, Notifications, Profile.");

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
