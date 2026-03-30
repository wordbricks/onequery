import type { InvalidateQueryFilters } from "@tanstack/react-query";

interface QueryMutationMeta extends Record<string, unknown> {
  invalidates?: InvalidateQueryFilters[];
}

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: QueryMutationMeta;
  }
}

export function resolveMutationInvalidations(
  meta: QueryMutationMeta | undefined
): InvalidateQueryFilters[] {
  return meta?.invalidates ?? [];
}
