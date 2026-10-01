import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";

const migrationsDir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

const migration = migrationFiles
  .map((file) => ({ file, sql: readFileSync(join(migrationsDir, file), "utf8") }))
  .reverse()
  .find(({ sql }) => (
    /create\s+or\s+replace\s+function\s+public\.set_exam_archived\s*\(\s*p_id\s+uuid\s*,\s*p_archived\s+boolean\s*\)/i.test(sql)
    && /returns\s+void\s+language\s+plpgsql\s+security\s+definer\s+set\s+search_path\s*=\s*public/i.test(sql)
    && /exam\.archived/i.test(sql)
    && /exam\.restored/i.test(sql)
  ));

assert.ok(migration, "Missing forward migration that restores trusted archive audit execution.");
assert.match(migration.sql, /language\s+plpgsql\s+security\s+definer\s+set\s+search_path\s*=\s*public/i);
assert.match(migration.sql, /actor_id\s+uuid\s*:=\s*\(select\s+auth\.uid\(\)\)/i);
assert.match(migration.sql, /where\s+id\s*=\s*p_id\s+and\s+\(\s*professor_id\s*=\s*actor_id\s+or\s+created_by\s*=\s*actor_id\s*\)/i);
assert.match(migration.sql, /perform\s+public\.write_audit_log\s*\(/i);
assert.match(migration.sql, /revoke\s+all\s+on\s+function\s+public\.set_exam_archived\s*\(\s*uuid\s*,\s*boolean\s*\)\s+from\s+public\s*,\s*anon/i);
assert.match(migration.sql, /grant\s+execute\s+on\s+function\s+public\.set_exam_archived\s*\(\s*uuid\s*,\s*boolean\s*\)\s+to\s+authenticated/i);
assert.doesNotMatch(migration.sql, /grant\s+execute\s+on\s+function\s+public\.write_audit_log/i);
