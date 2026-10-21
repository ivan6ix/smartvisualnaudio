/* global console */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// Every MICROPHONE_* violation type the student page records must exist in the violation_type
// enum (otherwise the insert fails with HTTP 400) and have a readable label in staff views.
const sources = ["src/pages/student/StudentExamTake.jsx", "src/hooks/useLiveAudioMonitoring.js", "src/lib/microphoneSignal.js"].map((file) => readFileSync(file, "utf8")).join("\n");
const recordedTypes = [...new Set(sources.match(/"MICROPHONE_[A-Z_]+"/g).map((type) => type.slice(1, -1)))].sort();
assert.deepEqual(recordedTypes, ["MICROPHONE_ACCESS_LOST", "MICROPHONE_DISCONNECTED", "MICROPHONE_MUTED", "MICROPHONE_UNAVAILABLE"]);

const migrations = readdirSync("supabase/migrations").filter((file) => file.endsWith(".sql")).map((file) => readFileSync(`supabase/migrations/${file}`, "utf8")).join("\n");
recordedTypes.forEach((type) => {
  assert.match(migrations, new RegExp(`alter type public\\.violation_type add value if not exists '${type}';`), `${type} must be added to violation_type by a migration.`);
});

for (const file of ["src/pages/professor/ProfessorMonitoring.jsx", "src/pages/professor/ProfessorDashboard.jsx", "src/pages/dean/DeanDashboard.jsx", "src/pages/dean/DeanExamIntegrity.jsx"]) {
  const page = readFileSync(file, "utf8");
  recordedTypes.forEach((type) => assert.match(page, new RegExp(`${type}: "Microphone [^"]+"`), `${file} must label ${type}.`));
}
const reports = readFileSync("src/pages/Reports.jsx", "utf8");
recordedTypes.forEach((type) => assert.ok(reports.includes(`"${type}"`), `Reports type filter must include ${type}.`));

console.log("microphone violation types ok");
