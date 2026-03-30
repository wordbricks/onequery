import { experimental_createQueryPersister } from "@tanstack/react-query-persist-client";
import { del, entries, get, set } from "idb-keyval";

import { QUERY_PERSIST_MAX_AGE_MS } from "./query-timing";

// Increment this when you need to invalidate all persisted caches
// (e.g., after breaking API changes or data schema changes)
const CACHE_BUSTER = "v2";

const storage = {
  entries: async () => entries<string, string>(),
  getItem: async (key: string) => get<string>(key),
  removeItem: async (key: string) => del(key),
  setItem: async (key: string, value: string) => set(key, value),
};

/**
 * Query persister using IndexedDB for offline-first dashboard loading.
 *
 * Uses experimental_createQueryPersister instead of PersistQueryClientProvider
 * for better Suspense compatibility and per-query lazy restoration.
 * See: https://github.com/TanStack/query/issues/6148
 */
export const queryPersister = experimental_createQueryPersister({
  buster: CACHE_BUSTER,
  // Note: gcTime in QueryClient can be shorter for memory efficiency because
  // persisted data is restored lazily on demand.
  maxAge: QUERY_PERSIST_MAX_AGE_MS,
  prefix: "onequery-query",
  storage,
});
