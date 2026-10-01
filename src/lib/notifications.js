export const NOTIFICATION_RECENT_LIMIT = 30;
export const NOTIFICATION_DROPDOWN_LIMIT = 8;
export const NOTIFICATION_HISTORY_PAGE_SIZE = 20;

export function buildNotificationRange(page) {
  const safePage = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
  const from = (safePage - 1) * NOTIFICATION_HISTORY_PAGE_SIZE;
  return { from, to: from + NOTIFICATION_HISTORY_PAGE_SIZE - 1 };
}

function sanitizeChannelPart(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function buildNotificationChannelName(userId, ownerId) {
  const safeUserId = sanitizeChannelPart(userId);
  const safeOwnerId = sanitizeChannelPart(ownerId);
  return safeUserId && safeOwnerId ? `notifications-${safeUserId}-${safeOwnerId}` : "";
}

export function isInternalNotificationPath(path) {
  return typeof path === "string"
    && path.startsWith("/")
    && !path.startsWith("//")
    && !/^[a-z][a-z0-9+.-]*:/i.test(path);
}

export function normalizeNotificationType(type) {
  const value = String(type || "").trim();
  if (!value) return "Notification";
  const normalized = value.replace(/_/g, " ");
  return normalized.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

export function sortNotifications(items) {
  return [...items].sort((first, second) => new Date(second.createdAt || second.created_at || 0) - new Date(first.createdAt || first.created_at || 0));
}

export function mergeRealtimeNotification(current = [], notification, limit = NOTIFICATION_RECENT_LIMIT) {
  if (!notification?.id || current.some((item) => item.id === notification.id)) {
    return sortNotifications(current).slice(0, limit);
  }
  return sortNotifications([notification, ...current]).slice(0, limit);
}
