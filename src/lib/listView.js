export const LIST_VIEWS = ["cards", "table"];
export const DENSITIES = ["comfortable", "compact", "dense"];
export const CARD_PAGE_SIZE = 12;
export const TABLE_PAGE_SIZE = 20;

export function normalizeListView(value, fallback = "table") {
  return LIST_VIEWS.includes(value) ? value : normalizeFallback(fallback, LIST_VIEWS, "table");
}

export function normalizeDensity(value, fallback = "compact") {
  return DENSITIES.includes(value) ? value : normalizeFallback(fallback, DENSITIES, "compact");
}

function normalizeFallback(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function getListPreferenceKeys(role, page) {
  const namespace = `${role}:${page}`;
  return {
    view: `smart-proctoring:list-view:${namespace}`,
    cardDensity: `smart-proctoring:card-density:${namespace}`,
    tableDensity: `smart-proctoring:table-density:${namespace}`,
  };
}

export function readStoredListValue(storage, key, fallback) {
  try {
    return storage?.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredListValue(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch {
    // Keep list presentation usable when localStorage is blocked.
  }
}

export function getPageSizeForView(view) {
  return view === "cards" ? CARD_PAGE_SIZE : TABLE_PAGE_SIZE;
}

export function toNextListPage({ currentPage, currentPageSize, nextPageSize, totalItems }) {
  const oldPage = Math.max(1, Number(currentPage) || 1);
  const oldSize = Math.max(1, Number(currentPageSize) || 1);
  const newSize = Math.max(1, Number(nextPageSize) || 1);
  const total = Math.max(0, Number(totalItems) || 0);
  const oldFirstIndex = (oldPage - 1) * oldSize;
  const totalPages = Math.max(1, Math.ceil(total / newSize));
  return Math.min(totalPages, Math.max(1, Math.floor(oldFirstIndex / newSize) + 1));
}

export function clampListPage(page, pageSize, totalItems) {
  const totalPages = Math.max(1, Math.ceil(Math.max(0, totalItems) / Math.max(1, pageSize)));
  return Math.min(totalPages, Math.max(1, Number(page) || 1));
}

export function getListPageSlice(rows, page, pageSize) {
  const items = Array.isArray(rows) ? rows : [];
  const safePageSize = Math.max(1, Number(pageSize) || 1);
  const safePage = clampListPage(page, safePageSize, items.length);
  const start = (safePage - 1) * safePageSize;
  return {
    rows: items.slice(start, start + safePageSize),
    page: safePage,
    totalPages: Math.max(1, Math.ceil(items.length / safePageSize)),
    start,
    pageSize: safePageSize,
  };
}
