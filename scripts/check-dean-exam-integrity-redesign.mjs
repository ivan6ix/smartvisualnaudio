import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.jsx", "utf8");
const layout = readFileSync("src/pages/dean/DeanLayout.jsx", "utf8");
const integrity = readFileSync("src/pages/dean/DeanExamIntegrity.jsx", "utf8");
const dashboard = readFileSync("src/pages/dean/DeanDashboard.jsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");

assert.match(app, /path="integrity" element=\{<DeanExamIntegrity \/>\}/, "Dean Exam Integrity route must remain available.");
assert.match(layout, /dean-topbar-actions[\s\S]*dean-theme-button[\s\S]*dean-message-menu[\s\S]*<NotificationBell user=\{user\} \/>[\s\S]*dean-profile-menu/, "Approved Dean shell topbar order must stay intact.");

assert.match(integrity, /className="dean-integrity-page"/, "Exam Integrity should use the scoped redesigned page container.");
assert.match(integrity, /Review examination integrity records and recorded monitoring events/, "Exam Integrity should keep a compact oversight header.");
assert.match(integrity, /from\("violations"\)[\s\S]*select\("id, student_id, exam_id, violation_type, description, severity, screenshot_url, evidence_url, evidence_type, audio_level, created_at"\)[\s\S]*limit\(500\)/, "Existing capped violation metadata query must be preserved.");
assert.match(integrity, /from\("profiles"\)[\s\S]*select\("id, full_name, student_number, email"\)/, "Existing student lookup must be preserved.");
assert.match(integrity, /from\("exams"\)[\s\S]*select\("id, title"\)/, "Existing exam lookup must be preserved.");
assert.match(integrity, /SearchBox[\s\S]*placeholder="Search student, exam, or violation"/, "Existing search behavior must remain visible.");
assert.match(integrity, /Severity Filter[\s\S]*Violation Type/, "Existing filters must remain visible.");
assert.match(integrity, /useListViewPreference\(\{ role: "dean", page: "exam-integrity", defaultView: "table" \}\)/, "Cards/Table preference must remain table-first.");
assert.match(integrity, /ListViewToolbar[\s\S]*onCardDensity[\s\S]*onTableDensity/, "View and density controls must remain wired.");
assert.match(integrity, /getListPageSlice\(filteredViolations, page, listView\.pageSize\)/, "Shared pagination must remain wired.");
assert.match(integrity, /Student[\s\S]*Student ID[\s\S]*Exam[\s\S]*Violation[\s\S]*Severity[\s\S]*Date[\s\S]*Time[\s\S]*Evidence/, "Actual integrity table columns must remain present.");
assert.match(integrity, /RecordCardList[\s\S]*Table/, "Cards/Table rendering paths must remain present.");
assert.match(integrity, /emptyTitle="No integrity records match the current filters\."/,"Filtered empty state must stay distinguishable.");
assert.match(integrity, /Unable to load integrity records\./, "Fetch errors must remain distinguishable from empty records.");
assert.match(integrity, /Loading integrity records\.\.\./, "Loading state must remain visible.");

assert.match(integrity, /function EvidenceCell[\s\S]*createSignedUrl\(row\.evidencePath, 60 \* 60\)/, "Evidence signed URLs must be generated only inside the row evidence action.");
assert.match(integrity, /if \(!row\.evidencePath \|\| !row\.evidenceBucket\) return "-";/, "Missing evidence must render without broken media.");
assert.match(integrity, /row\.evidenceKind === "audio"[\s\S]*<audio className="dean-integrity-audio" controls src=\{signedUrl\}>/, "Audio evidence must remain on-demand and playable only after signing.");
assert.match(integrity, /window\.open\("", "_blank"\)[\s\S]*pendingWindow\.location\.href = nextUrl/, "Screenshot evidence should open only after an on-demand signed URL is created.");
assert.match(integrity, /channel\("dean-exam-integrity"\)[\s\S]*postgres_changes[\s\S]*table: "violations"[\s\S]*removeChannel\(channel\)/, "Single realtime subscription lifecycle must remain scoped and cleaned up.");
assert.doesNotMatch(integrity, /Promise\.all\([\s\S]*createSignedUrl/, "Evidence must not be signed eagerly for every row.");

assert.match(styles, /\.dean-integrity-table-scroll\s*\{[\s\S]*overflow:\s*auto/, "Integrity table must use local scroll.");
assert.match(styles, /\.dean-integrity-table\s*\{[\s\S]*min-width:\s*980px/, "Integrity table must keep a readable local min-width.");
assert.match(styles, /\.dean-integrity-table table\s*\{[\s\S]*table-layout:\s*fixed/, "Integrity table should use proportional column sizing.");
assert.match(styles, /\.dean-integrity-records-panel \.list-record-card\s*\{[\s\S]*border-radius:\s*8px/, "Cards view should keep boxed record cards.");
assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*\.dean-integrity-filter-row/, "Integrity filters should wrap on narrower screens.");

assert.match(dashboard, /className="dean-dashboard-page"/, "Dean Dashboard should remain on the approved Phase 1 container.");
assert.doesNotMatch(dashboard, /dean-integrity-page/, "Dean Dashboard must not be redesigned by the integrity phase.");
