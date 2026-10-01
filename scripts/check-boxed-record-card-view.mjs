import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync("src/styles.css", "utf8");
const listControls = fs.readFileSync("src/components/ListViewControls.jsx", "utf8");
const listView = fs.readFileSync("src/lib/listView.js", "utf8");

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

check(listControls.includes('className="record-card__header"'), "Record cards must expose a reusable header element.");
check(listControls.includes('className="record-card__body"'), "Record cards must expose a reusable body element.");
check(listControls.includes('className="record-card__field"'), "Record cards must expose reusable field wrappers.");
check(listControls.includes('className="record-card__label"'), "Record cards must expose reusable field labels.");
check(listControls.includes('className="record-card__value"'), "Record cards must expose reusable field values.");

check(css.includes(".admin-section-page .list-record-card"), "Admin record cards must have scoped boxed-card styling.");
assert.match(css, /\.admin-section-page \.list-record-card\s*\{[\s\S]*border:\s*1px solid/, "Admin record cards need a visible 1px outline.");
assert.match(css, /\.admin-section-page \.list-record-card\s*\{[\s\S]*border-radius:\s*8px/, "Admin record cards should keep the approved 8px radius.");
assert.match(css, /\.admin-section-page \.list-record-card\s*\{[\s\S]*background:\s*#fff/, "Light mode Admin record cards should render on a white card surface.");
assert.match(css, /html\[data-theme="dark"\] \.admin-section-page \.list-record-card[\s\S]*border-color:\s*rgba\(226,\s*232,\s*240,\s*0\.58\)/, "Dark mode Admin record cards need a visible light outline.");

assert.match(css, /\.admin-section-page \.record-card__header\s*\{[\s\S]*border-bottom:\s*1px solid/, "Record card headers need a theme-aware divider.");
assert.match(css, /\.admin-section-page \.list-record-actions\s*\{[\s\S]*flex-shrink:\s*0/, "Record card action area must not shrink into unreadable controls.");
assert.match(css, /\.admin-section-page \.list-record-actions \.btn\s*\{[\s\S]*white-space:\s*nowrap/, "Record card action buttons must stay on one line where practical.");

check(css.includes("@media (min-width: 1200px)") && css.includes("repeat(4, minmax(0, 1fr))"), "Admin card grids should target four columns on large desktops.");
check(css.includes("@media (max-width: 767px)") && css.includes("grid-template-columns: 1fr"), "Admin card grids should collapse to one column on mobile.");

check(listView.includes("smart-proctoring:list-view:") && listView.includes("smart-proctoring:card-density:") && listView.includes("smart-proctoring:table-density:"), "Card/Table preference storage namespaces must remain intact.");
check(listView.includes("CARD_PAGE_SIZE = 12") && listView.includes("TABLE_PAGE_SIZE = 20"), "Card/Table pagination defaults must remain intact.");
