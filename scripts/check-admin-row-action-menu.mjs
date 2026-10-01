import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const peopleSource = readFileSync("src/pages/People.jsx", "utf8");
const uiSource = readFileSync("src/components/ui.jsx", "utf8");
const stylesSource = readFileSync("src/styles.css", "utf8");

assert.match(uiSource, /export function RowActionMenu\(/, "Expected a generic RowActionMenu component.");
assert.match(uiSource, /createPortal\(/, "RowActionMenu should portal the dropdown outside table overflow.");
assert.match(uiSource, /FiMoreVertical/, "RowActionMenu should use the existing vertical ellipsis icon.");
assert.match(uiSource, /document\.addEventListener\("mousedown"/, "Menu should close on outside click.");
assert.match(uiSource, /event\.key === "Escape"/, "Menu should close on Escape.");

assert.match(peopleSource, /<RowActionMenu[\s\S]*?rowId=\{row\.id\}/, "Create Account rows should use stable row ids for action menus.");
assert.match(peopleSource, /label:\s*"Reset Password"[\s\S]*?onClick:\s*\(\)\s*=>\s*resetPassword\(row\)/, "Reset Password action must stay wired to the current row.");
assert.match(peopleSource, /label:\s*"Deactivate"[\s\S]*?onClick:\s*\(\)\s*=>\s*setStatus\(row,\s*"Deactivated"\)/, "Deactivate action must stay wired to the current row.");
assert.match(peopleSource, /<Button\s+variant="light"\s+onClick=\{\(\)\s*=>\s*setStatus\(row,\s*"Active"\)\}>Reactivate<\/Button>/, "Single Reactivate action should remain directly wired.");
assert.doesNotMatch(peopleSource, /Reset Password<\/Button>\s*[\r\n\s]*<Button[^>]+Deactivate<\/Button>/, "Multiple account actions should not render as side-by-side table buttons.");

assert.match(stylesSource, /\.row-action-menu-trigger/, "Expected trigger styles for the generic row action menu.");
assert.match(stylesSource, /\.row-action-menu-popover/, "Expected popover styles for the generic row action menu.");
