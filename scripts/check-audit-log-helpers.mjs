import assert from "node:assert/strict";
import {
  AUDIT_LOG_PAGE_SIZE,
  buildAuditLogRange,
  getAuditLogSort,
  sanitizeAuditMetadata,
} from "../src/lib/auditLogs.js";

assert.equal(AUDIT_LOG_PAGE_SIZE, 20);
assert.deepEqual(buildAuditLogRange(1), { from: 0, to: 19 });
assert.deepEqual(buildAuditLogRange(3), { from: 40, to: 59 });
assert.deepEqual(buildAuditLogRange("bad"), { from: 0, to: 19 });

assert.deepEqual(getAuditLogSort("oldest"), { column: "created_at", ascending: true });
assert.deepEqual(getAuditLogSort("newest"), { column: "created_at", ascending: false });
assert.deepEqual(getAuditLogSort("anything"), { column: "created_at", ascending: false });

assert.deepEqual(
  sanitizeAuditMetadata({
    courseCode: "CS101",
    password: "secret",
    nested: { token: "hide", count: 2 },
    answers: ["raw"],
    safeId: "abc",
  }),
  {
    courseCode: "CS101",
    nested: { count: 2 },
    safeId: "abc",
  },
);
