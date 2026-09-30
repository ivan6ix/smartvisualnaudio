import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/pages/Courses.jsx", "utf8");

const courseRecordsIndex = source.indexOf("Course Records");
const archivesIndex = source.indexOf("Archives");
const pageHeaderIndex = source.indexOf("title=\"Courses\"");

assert.ok(courseRecordsIndex >= 0, "Course Records header must exist");
assert.ok(archivesIndex > courseRecordsIndex, "Archives button must be inside/after Course Records header, not the top page header");
assert.ok(pageHeaderIndex >= 0 && !source.slice(pageHeaderIndex, courseRecordsIndex).includes("Archived Courses"), "Top Courses page header must not contain the archives entry point");
assert.match(source, /Archive Course\?/);
assert.match(source, /Restore Course\?/);
assert.match(source, /Delete Permanently/);
assert.match(source, /deleteConfirmationText === "DELETE"/);
assert.match(source, /deletingCourseId/);
assert.match(source, /supabase\.functions\.invoke\("admin-delete-course"/);
assert.ok(source.indexOf("Delete Permanently") > source.indexOf("Archived Courses"), "Permanent delete must only appear in Archived Courses UI");
