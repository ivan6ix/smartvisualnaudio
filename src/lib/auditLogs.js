export const AUDIT_LOG_PAGE_SIZE = 20;

const SECRET_KEY_PATTERN = /(password|token|secret|key|answer|signed|url|frame|audio|recording|submission)/i;

export function buildAuditLogRange(page, pageSize = AUDIT_LOG_PAGE_SIZE) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.max(1, Number(pageSize) || AUDIT_LOG_PAGE_SIZE);
  const from = (safePage - 1) * safeSize;
  return { from, to: from + safeSize - 1 };
}

export function getAuditLogSort(value) {
  return { column: "created_at", ascending: value === "oldest" };
}

export function sanitizeAuditMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SECRET_KEY_PATTERN.test(key))
      .map(([key, item]) => [key, sanitizeAuditMetadataValue(item)])
      .filter(([, item]) => item !== undefined),
  );
}

function sanitizeAuditMetadataValue(value) {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return undefined;
  if (typeof value === "object") {
    const nested = sanitizeAuditMetadata(value);
    return Object.keys(nested).length ? nested : undefined;
  }
  return undefined;
}

export function formatAuditDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

export function formatAuditEntity(log) {
  const type = log?.entity_type || "system";
  const id = log?.entity_id ? String(log.entity_id).slice(0, 8) : "";
  return id ? `${type} ${id}` : type;
}

export function mapAuditLogRow(log) {
  const actor = log?.profiles;
  return {
    id: log.id,
    createdAt: formatAuditDate(log.created_at),
    actor: actor?.full_name || actor?.email || log.user_id || "System",
    role: log.actor_role || actor?.role || "-",
    action: log.action || log.event_type || "-",
    eventType: log.event_type || "-",
    entity: formatAuditEntity(log),
    entityType: log.entity_type || "-",
    description: log.description || "-",
    targetUserId: log.target_user_id || "",
    metadata: sanitizeAuditMetadata(log.metadata),
    raw: log,
  };
}
