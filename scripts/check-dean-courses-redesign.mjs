import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.jsx", "utf8");
const layout = readFileSync("src/pages/dean/DeanLayout.jsx", "utf8");
const courses = readFileSync("src/pages/Courses.jsx", "utf8");
const dashboard = readFileSync("src/pages/dean/DeanDashboard.jsx", "utf8");
const integrity = readFileSync("src/pages/dean/DeanExamIntegrity.jsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");

assert.match(app, /<Route path="courses" element=\{<Courses \/>\} \/>/, "Dean Courses route must remain available.");
assert.match(layout, /dean-topbar-actions[\s\S]*dean-theme-button[\s\S]*dean-message-menu[\s\S]*<NotificationBell user=\{user\} \/>[\s\S]*dean-profile-menu/, "Approved Dean shell topbar order must stay intact.");

assert.match(courses, /const isReadOnly = user\?\.role === "Dean"/, "Dean Courses must remain role-scoped read-only.");
assert.match(courses, /useListViewPreference\(\{ role: isReadOnly \? "dean" : "admin", page: "courses", defaultView: "table" \}\)/, "Dean/Admin course list preferences must remain separately scoped.");
assert.match(courses, /queryKey: \["admin-courses"\]/, "Existing course query key must be preserved.");
assert.match(courses, /from\("courses"\)[\s\S]*select\("id, course_name, course_code, program_id, year_level, section, semester, academic_year, joining_code, professor_id, archived, created_at, programs\(program_code, program_name, is_active\)"\)/, "Existing course fields/query must be preserved.");
assert.match(courses, /from\("profiles"\)[\s\S]*eq\("role", "Professor"\)[\s\S]*eq\("status", "Active"\)/, "Existing professor lookup must be preserved.");
assert.match(courses, /from\("programs"\)[\s\S]*select\("id, program_code, program_name, is_active, created_at"\)/, "Existing program lookup must be preserved.");
assert.match(courses, /channel\("courses-live"\)[\s\S]*table: "courses"[\s\S]*table: "programs"[\s\S]*removeChannel\(channel\)/, "Existing realtime invalidation lifecycle must remain scoped and cleaned up.");

assert.match(courses, /className=\{`admin-dashboard-page admin-section-page\$\{isReadOnly \? " dean-courses-page" : ""\}`\}/, "Dean Courses should use a scoped redesigned page class.");
assert.match(courses, /View and oversee academic courses and their examination activity/, "Dean Courses should keep a compact oversight header.");
assert.match(courses, /dean-courses-controls[\s\S]*SearchBox[\s\S]*placeholder="Search course or professor"/, "Dean course search must remain visible and compact.");
assert.match(courses, /Course Name[\s\S]*Course Code[\s\S]*Program[\s\S]*Section[\s\S]*Professor[\s\S]*Status/, "Dean course columns must preserve existing displayed fields.");
assert.match(courses, /ListViewToolbar[\s\S]*onCardDensity[\s\S]*onTableDensity/, "Cards/Table and density controls must remain wired.");
assert.match(courses, /getListPageSlice\(visible, page, listView\.pageSize\)/, "Shared pagination must remain wired.");
assert.match(courses, /RecordCardList[\s\S]*dean-courses-table/, "Cards and table presentation paths must remain available.");
assert.match(courses, /Unable to load courses\./, "Fetch errors must remain distinguishable from empty course results.");
assert.match(courses, /Loading courses\.\.\./, "Loading state must remain visible.");
assert.match(courses, /No courses match the current search\./, "Filtered empty state must remain visible.");
assert.match(courses, /!\s*isReadOnly \? <PageHeader title="Courses"/, "Admin create/manage header must stay hidden for Dean.");
assert.match(courses, /!\s*isReadOnly \? \([\s\S]*onSubmit=\{createCourse\}/, "Admin create course form must stay hidden for Dean.");
assert.match(courses, /!\s*isReadOnly && hasSupabaseConfig/, "Admin program management must stay hidden for Dean.");
assert.match(courses, /!\s*isReadOnly \? \([\s\S]*setShowArchived\(true\)/, "Archive actions must stay hidden for Dean.");

assert.match(styles, /\.dean-courses-table-scroll\s*\{[\s\S]*overflow:\s*auto/, "Dean Courses table must use local scrolling.");
assert.match(styles, /\.dean-courses-table\s*\{[\s\S]*min-width:\s*920px/, "Dean Courses table must keep readable local min-width.");
assert.match(styles, /\.dean-courses-table table\s*\{[\s\S]*table-layout:\s*fixed/, "Dean Courses table should use proportional columns.");
assert.match(styles, /\.dean-courses-records-panel \.list-record-card\s*\{[\s\S]*border:\s*1px solid rgba\(15,\s*23,\s*42,\s*0\.42\)/, "Dean Courses card view should use true boxed cards.");
assert.match(styles, /html\[data-theme="dark"\] \.dean-courses-records-panel \.list-record-card[\s\S]*border-color:\s*rgba\(226,\s*232,\s*240,\s*0\.48\)/, "Dean Courses cards must remain readable in dark mode.");
assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*\.dean-courses-table/, "Dean Courses table must keep responsive containment.");

assert.match(dashboard, /className="dean-dashboard-page"/, "Dean Dashboard should remain on the approved Phase 1 container.");
assert.match(integrity, /className="dean-integrity-page"/, "Dean Exam Integrity should remain on the approved Phase 2 container.");
assert.doesNotMatch(dashboard, /dean-courses-page/, "Dean Dashboard must not be redesigned by the courses phase.");
assert.doesNotMatch(integrity, /dean-courses-page/, "Dean Exam Integrity must not be redesigned by the courses phase.");
