import { useEffect, useMemo, useState } from "react";
import {
  getListPreferenceKeys,
  getPageSizeForView,
  normalizeDensity,
  normalizeListView,
  readStoredListValue,
  toNextListPage,
  writeStoredListValue,
} from "../lib/listView";

function getStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export default function useListViewPreference({ role, page, defaultView = "table" }) {
  const keys = useMemo(() => getListPreferenceKeys(role, page), [page, role]);
  const [view, setViewState] = useState(() => normalizeListView(readStoredListValue(getStorage(), keys.view, defaultView), defaultView));
  const [cardDensity, setCardDensityState] = useState(() => normalizeDensity(readStoredListValue(getStorage(), keys.cardDensity, "compact")));
  const [tableDensity, setTableDensityState] = useState(() => normalizeDensity(readStoredListValue(getStorage(), keys.tableDensity, "compact")));

  useEffect(() => {
    setViewState(normalizeListView(readStoredListValue(getStorage(), keys.view, defaultView), defaultView));
    setCardDensityState(normalizeDensity(readStoredListValue(getStorage(), keys.cardDensity, "compact")));
    setTableDensityState(normalizeDensity(readStoredListValue(getStorage(), keys.tableDensity, "compact")));
  }, [defaultView, keys]);

  function setView(nextView) {
    const normalized = normalizeListView(nextView, defaultView);
    setViewState(normalized);
    writeStoredListValue(getStorage(), keys.view, normalized);
  }

  function setCardDensity(nextDensity) {
    const normalized = normalizeDensity(nextDensity);
    setCardDensityState(normalized);
    writeStoredListValue(getStorage(), keys.cardDensity, normalized);
  }

  function setTableDensity(nextDensity) {
    const normalized = normalizeDensity(nextDensity);
    setTableDensityState(normalized);
    writeStoredListValue(getStorage(), keys.tableDensity, normalized);
  }

  function switchViewPreservingPage(nextView, currentPage, totalItems) {
    const normalized = normalizeListView(nextView, defaultView);
    const nextPage = toNextListPage({
      currentPage,
      currentPageSize: getPageSizeForView(view),
      nextPageSize: getPageSizeForView(normalized),
      totalItems,
    });
    setView(normalized);
    return nextPage;
  }

  return {
    cardDensity,
    pageSize: getPageSizeForView(view),
    setCardDensity,
    setTableDensity,
    setView,
    switchViewPreservingPage,
    tableDensity,
    view,
    viewDensity: view === "cards" ? cardDensity : tableDensity,
  };
}
