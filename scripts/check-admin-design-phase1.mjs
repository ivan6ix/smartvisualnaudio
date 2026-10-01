import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const appShell = readFileSync(new URL("../src/components/AppShell.jsx", import.meta.url), "utf8");
const protectedRoute = readFileSync(new URL("../src/routes/ProtectedRoute.jsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../src/pages/Dashboard.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

[
  ["Dashboard", "/"],
  ["Create Account", "/create-account"],
  ["Courses", "/courses"],
  ["Accounts", "/accounts"],
  ["Reports", "/reports"],
  ["Logs", "/admin/logs"],
].forEach(([label, route]) => {
  assert.ok(appShell.includes(label), `Admin sidebar missing ${label}`);
  assert.ok(appShell.includes(route), `Admin sidebar missing ${route}`);
});

["Help & Support", "/help", "/monitoring", ">Exams<"].forEach((token) => {
  assert.ok(!appShell.includes(token), `Admin shell should not add fake navigation token: ${token}`);
});

assert.ok(protectedRoute.includes("AppShell"), "Admin protected route should use the application shell.");
assert.ok(protectedRoute.includes('role="Admin"'), "Admin shell must be scoped to Admin only.");
assert.ok(appShell.includes("aria-label=\"Open admin navigation\""), "Mobile drawer button needs an accessible label.");
assert.ok(appShell.includes("admin-drawer-backdrop"), "Mobile drawer must include a backdrop.");
assert.ok(appShell.includes("NotificationBell"), "Admin topbar must preserve notifications.");
assert.ok(appShell.includes("MessageModal"), "Admin topbar must preserve messages.");
assert.ok(appShell.includes("ProfileMenu"), "Admin topbar must preserve profile actions.");
assert.ok(appShell.includes("toggleTheme"), "Admin topbar must preserve theme toggle.");

["System Overview", "Monitor users, courses, exams, and system integrity.", "System Health", "Violation Analytics", "Recent Account Activity"].forEach((token) => {
  assert.ok(dashboard.includes(token), `Dashboard missing required section text: ${token}`);
});
["Quick Actions</span>", "Active Exams</span>"].forEach((token) => {
  assert.ok(!dashboard.includes(token), `Dashboard should remove panel text: ${token}`);
});
assert.ok(!dashboard.includes("Admin Command Center"), "Dashboard must remove command-center language.");
assert.ok(!dashboard.includes("admin-hero-hud"), "Dashboard must remove decorative HUD visualization.");

["--surface-hover", "--text-primary", "--border-strong", "--primary-soft", "--radius-card", "--shadow-low"].forEach((token) => {
  assert.ok(css.includes(token), `Missing design token ${token}`);
});
[".admin-app-shell", ".admin-sidebar", ".admin-topbar", ".admin-drawer-backdrop", "@media (max-width: 900px)"].forEach((token) => {
  assert.ok(css.includes(token), `Missing Admin shell CSS token ${token}`);
});
assert.ok(css.includes("grid-template-columns: 248px minmax(0, 1fr)"), "Admin desktop shell should reserve a sidebar column.");
assert.ok(css.includes("transform: translateX(-100%)"), "Mobile sidebar should be off-canvas by default.");
