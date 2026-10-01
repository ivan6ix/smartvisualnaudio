import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { join } from "node:path";

const migrationsDir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

const policyMigration = migrationFiles
  .map((file) => ({ file, sql: readFileSync(join(migrationsDir, file), "utf8") }))
  .find(({ sql }) => /violations_student_update_own/i.test(sql) && /for\s+update\s+to\s+authenticated/i.test(sql));

assert.ok(policyMigration, "Missing forward migration for the student-owned violation evidence update policy.");
assert.match(policyMigration.sql, /drop\s+policy\s+if\s+exists\s+"violations_student_update_own"\s+on\s+public\.violations/i);
assert.match(policyMigration.sql, /create\s+policy\s+"violations_student_update_own"\s+on\s+public\.violations/i);
assert.match(policyMigration.sql, /for\s+update\s+to\s+authenticated/i);
assert.match(policyMigration.sql, /using\s*\(\s*\(select\s+auth\.uid\(\)\)\s*=\s*student_id\s*\)/i);
assert.match(policyMigration.sql, /with\s+check\s*\(\s*\(select\s+auth\.uid\(\)\)\s*=\s*student_id\s*\)/i);
assert.doesNotMatch(policyMigration.sql, /using\s*\(\s*true\s*\)/i);
assert.doesNotMatch(policyMigration.sql, /with\s+check\s*\(\s*true\s*\)/i);
