import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboard = readFileSync("src/pages/dean/DeanDashboard.jsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");

assert.match(dashboard, /className="dean-dashboard-page"/, "Dean Dashboard container must remain present.");
assert.match(dashboard, /ListViewToolbar[\s\S]*Table/, "Dean Dashboard table/list preferences must remain wired.");
assert.match(dashboard, /className=\{`dean-dashboard-violations-table list-table-\$\{listView\.tableDensity\}`\}/, "Dean Dashboard table density classes must remain wired.");

[
  ".dean-app-shell[data-role=\"Dean\"]",
  ".dean-shell",
  ".dean-dashboard-page",
  "width: 100%",
  "max-width: 100%",
  "overflow-x: clip",
].forEach((token) => {
  assert.ok(styles.includes(token), `Dean mobile shell width fix missing token: ${token}`);
});

assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.dean-kpi-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, "Dean KPI cards should become readable 2-column mobile grid.");
assert.match(styles, /@media \(max-width: 340px\)[\s\S]*\.dean-kpi-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/, "Dean KPI cards should fall back to one column at very narrow widths.");

assert.match(styles, /\.dean-chart-box\s*\{[\s\S]*overflow-x:\s*auto/, "Dean chart box should locally scroll when the chart needs readable width.");
assert.match(styles, /\.dean-chart-box \.recharts-responsive-container\s*\{[\s\S]*min-width:\s*640px/, "Dean chart should keep a readable local min width.");

assert.match(styles, /\.dean-dashboard-violations-table\s*\{[\s\S]*min-width:\s*1120px/, "Dean Dashboard violations table should keep readable local min-width.");
assert.match(styles, /\.dean-dashboard-violations-table table\s*\{[\s\S]*table-layout:\s*fixed/, "Dean Dashboard violations table should preserve fixed table layout.");
assert.match(styles, /\.dean-dashboard-violations-table th,[\s\S]*\.dean-dashboard-violations-table td\s*\{[\s\S]*white-space:\s*nowrap/, "Dean Dashboard violations table should prevent character wrapping.");
assert.match(styles, /\.dean-dashboard-violations-table th:nth-child\(1\),[\s\S]*\.dean-dashboard-violations-table td:nth-child\(1\)\s*\{[\s\S]*width:\s*170px/, "Dean Dashboard Student column needs a readable width.");
assert.match(styles, /\.dean-dashboard-violations-table th:nth-child\(2\),[\s\S]*\.dean-dashboard-violations-table td:nth-child\(2\)\s*\{[\s\S]*width:\s*130px/, "Dean Dashboard Student ID column needs a readable width.");
assert.match(styles, /\.dean-dashboard-violations-table th:nth-child\(6\),[\s\S]*\.dean-dashboard-violations-table td:nth-child\(6\)\s*\{[\s\S]*width:\s*110px/, "Dean Dashboard Severity column needs a readable width.");
assert.match(styles, /\.dean-dashboard-violations-table th:nth-child\(7\),[\s\S]*\.dean-dashboard-violations-table td:nth-child\(7\)\s*\{[\s\S]*width:\s*120px/, "Dean Dashboard Date column needs a readable width.");

assert.match(styles, /\.dean-dashboard-filters\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*180px\),\s*1fr\)\)/, "Dean Dashboard filters should auto-fit without clipping.");
