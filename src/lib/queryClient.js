import { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 3 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const PERSISTED_QUERY_NAMES = new Set([
  "student-dashboard",
  "professor-courses",
  "admin-courses",
]);

export const queryPersister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "smartvisualnaudio.query-cache.v1",
  throttleTime: 1000,
});

export const queryPersistOptions = {
  persister: queryPersister,
  maxAge: 24 * 60 * 60 * 1000,
  buster: "2026-08-performance-v1",
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => (
      query.state.status === "success"
      && PERSISTED_QUERY_NAMES.has(query.queryKey[0])
    ),
  },
};
