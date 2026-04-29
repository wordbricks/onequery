import { sanitizeAuditSearch } from "@onequery/audit-contracts/audit";
import type { AuditSearch } from "@onequery/audit-contracts/audit";

export type AuditDraftFilters = {
  q: string;
  sourceKey: string;
};

function normalizeSearchValue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeAuditDraftFilters(draft: AuditDraftFilters) {
  return {
    q: normalizeSearchValue(draft.q),
    sourceKey: normalizeSearchValue(draft.sourceKey),
  };
}

export function createAuditDraftFilters(
  search: Pick<AuditSearch, "q" | "sourceKey">
): AuditDraftFilters {
  return {
    q: search.q ?? "",
    sourceKey: search.sourceKey ?? "",
  };
}

export function getAuditDraftResetKey(
  search: Pick<AuditSearch, "q" | "sourceKey">
) {
  return `${search.q ?? ""}\u0000${search.sourceKey ?? ""}`;
}

export function hasPendingAuditDraftFilters(
  search: Pick<AuditSearch, "q" | "sourceKey">,
  draft: AuditDraftFilters
) {
  const normalizedDraft = normalizeAuditDraftFilters(draft);

  return (
    normalizedDraft.q !== search.q ||
    normalizedDraft.sourceKey !== search.sourceKey
  );
}

export function buildAuditSearchWithDraft(
  search: AuditSearch,
  draft: AuditDraftFilters,
  next: Partial<AuditSearch>
): AuditSearch {
  return sanitizeAuditSearch({
    ...search,
    ...normalizeAuditDraftFilters(draft),
    ...next,
  });
}
