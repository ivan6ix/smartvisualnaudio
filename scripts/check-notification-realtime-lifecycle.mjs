import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildNotificationChannelName } from "../src/lib/notifications.js";

assert.equal(buildNotificationChannelName("user-1", "bell-1"), "notifications-user-1-bell-1");
assert.equal(buildNotificationChannelName("user/1", ":r2:"), "notifications-user-1-r2");
assert.equal(buildNotificationChannelName("", "bell"), "");
assert.equal(buildNotificationChannelName("user-1", ""), "");

const hookSource = readFileSync("src/hooks/useNotifications.js", "utf8");
const subscribeIndex = hookSource.indexOf(".subscribe(");
const channelIndex = hookSource.indexOf("buildNotificationChannelName");
const postgresIndexes = [...hookSource.matchAll(/\.on\("postgres_changes"/g)].map((match) => match.index);

assert.ok(channelIndex > -1, "useNotifications must create an owner-scoped notification channel name");
assert.ok(subscribeIndex > -1, "useNotifications must subscribe to the channel");
assert.ok(postgresIndexes.length >= 2, "useNotifications should retain INSERT and UPDATE postgres_changes listeners");
assert.ok(postgresIndexes.every((index) => index < subscribeIndex), "all postgres_changes listeners must be registered before subscribe()");
assert.ok(hookSource.includes("supabase.removeChannel(channel)"), "notification realtime cleanup must remove the channel");
assert.ok(!hookSource.includes("channel.on(\"postgres_changes\"") || hookSource.indexOf("channel.on(\"postgres_changes\"") < subscribeIndex, "no postgres_changes listener may be added after subscribe()");
