/* global console */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync("src/main.jsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");
const student = readFileSync("src/student-portal.css", "utf8");
const responsive = readFileSync("src/responsive.css", "utf8");

// The responsive layer loads last so it adapts every role's pages.
assert.ok(main.indexOf('import "./student-portal.css";') < main.indexOf('import "./responsive.css";'), "responsive.css must load after the other stylesheets.");

// Words wrap between words; only the two long free-text areas may still break anywhere.
const anywhere = [...`${styles}\n${student}`.matchAll(/([^{}]*)\{[^{}]*overflow-wrap:\s*anywhere/g)].map((match) => match[1].trim());
assert.equal(anywhere.length, 2, `Only the kept exceptions may break words anywhere, found: ${anywhere.join(" | ")}`);
assert.ok(anywhere.every((selector) => /cluster-question-preview|reports-print-table-wrap/.test(selector)));

// Phones and tablets: shrinkable sections, tables scrolling in their card, 12 px minimum text, two summary cards per row.
assert.match(responsive, /@media \(max-width: 1024px\)[\s\S]*main :where\(section, div, article, header, aside, form, ul, li, fieldset\) \{\s*min-width: 0;/);
assert.match(responsive, /main :where\(div, section\):has\(> table\) \{[\s\S]*overflow-x: auto !important;/);
assert.match(responsive, /font-size: max\(0\.75rem, 12px\) !important;/);
assert.match(responsive, /@media \(max-width: 760px\)[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/);

// The top bar's profile avatar stays visible on phones (only text labels are hidden).
assert.doesNotMatch(styles, /\.profile-menu > button span \{ display: none; \}/);
assert.doesNotMatch(styles, /\.(cluster-)?profile-menu > button span,\s*\n/);

console.log("Responsive layout checks passed.");
