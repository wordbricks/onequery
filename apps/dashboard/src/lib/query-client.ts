import { MutationCache, QueryClient } from "@tanstack/react-query";

import { resolveMutationInvalidations } from "./query-mutation-meta";
import { queryPersister } from "./query-persister";
import { QUERY_GC_TIME_MS, SHORT_QUERY_STALE_TIME_MS } from "./query-timing";

// Memory-efficient gcTime (5 minutes)
// Persisted data (24h maxAge) is restored lazily when queries are re-mounted
const isE2E =
  (globalThis as typeof globalThis & { __ONEQUERY_E2E__?: boolean })
    .__ONEQUERY_E2E__ === true;

export function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Disable refetch on window focus for better UX
        refetchOnWindowFocus: false,
        // E2E should fail fast instead of paying for retry latency.
        retry: isE2E ? false : 1,
        // Data considered stale after 30 seconds
        staleTime: SHORT_QUERY_STALE_TIME_MS,
        // Short gcTime for memory efficiency; persisted data restored on demand
        gcTime: QUERY_GC_TIME_MS,
        // IndexedDB persistence is useful in product runtime, but it is
        // background I/O noise during E2E runs.
        persister: isE2E ? undefined : queryPersister.persisterFn,
      },
    },
    mutationCache: new MutationCache({
      onSuccess: async (_data, _variables, _context, mutation) => {
        // Comment: mutation keys identify the mutation itself. They are not a
        // reliable description of which queries should be invalidated.
        const invalidations = resolveMutationInvalidations(
          mutation.options.meta
        );
        await Promise.all(
          invalidations.map(async (filters) =>
            queryClient.invalidateQueries(filters)
          )
        );
      },
    }),
  });
  return queryClient;
}
