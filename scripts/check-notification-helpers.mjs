import assert from "node:assert/strict";
import {
  NOTIFICATION_HISTORY_PAGE_SIZE,
  NOTIFICATION_RECENT_LIMIT,
  buildNotificationRange,
  isInternalNotificationPath,
  mergeRealtimeNotification,
  normalizeNotificationType,
} from "../src/lib/notifications.js";

assert.equal(NOTIFICATION_RECENT_LIMIT, 30);
assert.equal(NOTIFICATION_HISTORY_PAGE_SIZE, 20);
assert.deepEqual(buildNotificationRange(1), { from: 0, to: 19 });
assert.deepEqual(buildNotificationRange(3), { from: 40, to: 59 });
assert.deepEqual(buildNotificationRange("bad"), { from: 0, to: 19 });

assert.equal(isInternalNotificationPath("/cluster/exams/123"), true);
assert.equal(isInternalNotificationPath("https://example.com"), false);
assert.equal(isInternalNotificationPath("//example.com"), false);
assert.equal(isInternalNotificationPath("javascript:alert(1)"), false);
assert.equal(isInternalNotificationPath(""), false);
assert.equal(isInternalNotificationPath(null), false);

const existing = [
  { id: "old", createdAt: "2026-09-29T10:00:00.000Z" },
  { id: "newer", createdAt: "2026-09-30T10:00:00.000Z" },
];
assert.deepEqual(
  mergeRealtimeNotification(existing, { id: "new", createdAt: "2026-09-30T11:00:00.000Z" }).map((item) => item.id),
  ["new", "newer", "old"],
);
assert.deepEqual(
  mergeRealtimeNotification(existing, { id: "old", createdAt: "2026-10-01T10:00:00.000Z" }).map((item) => item.id),
  ["newer", "old"],
);
assert.equal(
  mergeRealtimeNotification(
    Array.from({ length: 30 }, (_, index) => ({ id: `n-${index}`, createdAt: `2026-09-30T10:${String(index).padStart(2, "0")}:00.000Z` })),
    { id: "fresh", createdAt: "2026-09-30T11:00:00.000Z" },
  ).length,
  30,
);

assert.equal(normalizeNotificationType("permit_request"), "Permit Request");
assert.equal(normalizeNotificationType("Exam Review"), "Exam Review");
assert.equal(normalizeNotificationType(""), "Notification");
