/* global console */
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const css = read("src/styles.css");
const ui = read("src/components/ui.jsx");
const clusterContext = read("src/context/ClusterContext.jsx");

assert.match(ui, /export function ListSkeleton\(/, "ui.jsx must export the shared ListSkeleton.");
assert.match(ui, /export function SkeletonValue\(/, "ui.jsx must export SkeletonValue for KPI numbers.");
assert.match(ui, /role="status" aria-busy="true"/, "ListSkeleton must announce a busy status region.");
assert.match(ui, /className="sr-only">\{label\}/, "ListSkeleton must keep a screen-reader loading label.");
for (const variant of ["table", "cards", "records", "stats"]) {
  assert.match(ui, new RegExp(`variant === "${variant}"`), `ListSkeleton must support the ${variant} variant.`);
}

assert.match(css, /\.skeleton-block::after\s*\{[\s\S]*?var\(--skeleton-highlight\)/, "Shimmer must use a highlight distinct from the block base.");
assert.match(css, /html\[data-appearance="light"\] \.skeleton-block\s*\{/, "Skeleton blocks need light-theme colors.");
assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.skeleton-block::after\s*\{[^}]*animation:\s*none/, "Skeleton shimmer must stop for reduced motion.");
assert.match(css, /\.sr-only\s*\{/, "The sr-only utility must exist for skeleton labels.");
assert.match(css, /@media \(max-width: 767px\)\s*\{[\s\S]*?\.list-skeleton--cards,\s*\.list-skeleton--records\s*\{\s*grid-template-columns:\s*1fr/, "Card skeletons must collapse to one column on mobile.");
assert.doesNotMatch(css, /html\[data-theme\] \.skeleton-block/, "The global theme override must not flatten skeleton colors.");

assert.match(clusterContext, /const \[clusterReady, setClusterReady\] = useState\(!hasSupabaseConfig\)/, "ClusterContext must track its first live load.");
assert.match(clusterContext, /loadLiveClusterData\(\)\.finally\(\(\) => setClusterReady\(true\)\)/, "clusterReady must flip after the first live load settles.");
assert.match(clusterContext, /\n\s+clusterReady,\n/, "ClusterContext must expose clusterReady.");

const pages = [
  "src/pages/student/StudentDashboard.jsx",
  "src/pages/student/StudentResources.jsx",
  "src/pages/student/StudentCourse.jsx",
  "src/pages/student/StudentGrades.jsx",
  "src/pages/professor/ProfessorCourses.jsx",
  "src/pages/professor/ProfessorExams.jsx",
  "src/pages/professor/ProfessorDashboard.jsx",
  "src/pages/professor/ProfessorScores.jsx",
  "src/pages/professor/ProfessorOngoingExams.jsx",
  "src/pages/professor/ProfessorCoursePermits.jsx",
  "src/pages/professor/ProfessorCourseDetail.jsx",
  "src/pages/cluster/ClusterDashboard.jsx",
  "src/pages/cluster/ClusterExamList.jsx",
  "src/pages/cluster/ClusterHistory.jsx",
  "src/pages/cluster/ClusterReports.jsx",
  "src/pages/dean/DeanDashboard.jsx",
  "src/pages/dean/DeanExamIntegrity.jsx",
  "src/pages/Reports.jsx",
  "src/pages/Courses.jsx",
  "src/pages/Accounts.jsx",
  "src/pages/AdminLogs.jsx",
  "src/pages/Dashboard.jsx",
];
for (const page of pages) {
  assert.match(read(page), /<ListSkeleton\b/, `${page} must render ListSkeleton while its first load is in progress.`);
}

// First-load only: background refetches must not swap content for a skeleton.
assert.doesNotMatch(read("src/pages/student/StudentDashboard.jsx"), /dashboardQuery\.isFetching/, "Student dashboard must not show loading on background refetch.");
assert.doesNotMatch(read("src/pages/professor/ProfessorOngoingExams.jsx"), /setLoading\(true\)/, "Ongoing exams polling must not re-enter the loading state.");
assert.match(read("src/pages/professor/ProfessorScores.jsx"), /if \(loading && !scoresReady\)/, "Scores must keep content visible on reloads after the first load.");
assert.match(read("src/pages/AdminLogs.jsx"), /logsQuery\.isLoading \? <ListSkeleton/, "Audit logs must only show the skeleton when no data is loaded.");

for (const label of ["Loading courses...", "Loading integrity records...", "Loading reports..."]) {
  assert.ok(pages.some((page) => read(page).includes(`label="${label}"`)), `Skeleton label "${label}" must remain for screen readers.`);
}

console.log("skeleton loading checks passed");
