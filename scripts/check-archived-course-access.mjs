/* global URL, console */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// Students must not see an archived course until an admin restores it.
const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
const migrations = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort();

// The newest definition of each function is the one that counts.
function latestDefinition(functionName) {
  const pattern = new RegExp(`create or replace function public\\.${functionName}\\([\\s\\S]*?\\$\\$;`, "gi");
  let latest = "";
  for (const name of migrations) {
    const sql = readFileSync(new URL(name, migrationsDir), "utf8");
    for (const match of sql.matchAll(pattern)) latest = match[0];
  }
  assert.ok(latest, `${functionName} should be defined in a migration.`);
  return latest;
}

assert.match(latestDefinition("is_student_enrolled_in_course"), /not\s+c\.archived/i, "A student's course access must skip archived courses.");
assert.match(latestDefinition("student_can_take_exam"), /not\s+c\.archived/i, "Exams in archived courses must stay hidden from students.");
assert.match(latestDefinition("join_course_by_code"), /not\s+c\.archived/i, "Students must not be able to join an archived course.");

// The student pages drop enrollments whose course is hidden.
const dashboard = readFileSync(new URL("../src/pages/student/StudentDashboard.jsx", import.meta.url), "utf8");
assert.match(dashboard, /mapLiveCourse\(enrollment\.courses\)\)\.filter\(Boolean\)/, "The student dashboard must skip courses it cannot read.");
const coursePage = readFileSync(new URL("../src/pages/student/StudentCourse.jsx", import.meta.url), "utf8");
assert.match(coursePage, /You do not have access to this course\./, "Opening a hidden course must show the no-access message.");

console.log("archived course access checks passed");
