import {
  auditListParamsSchema,
  clearIncompatibleAuditActionName,
} from "@onequery/audit-contracts/audit";
import type { AuditListParams } from "@onequery/audit-contracts/audit";

type AuditDraftFilters = {
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
  search: Pick<AuditListParams, "q" | "sourceKey">
): AuditDraftFilters {
  return {
    q: search.q ?? "",
    sourceKey: search.sourceKey ?? "",
  };
}

export function getAuditDraftResetKey(
  search: Pick<AuditListParams, "q" | "sourceKey">
) {
  return `${search.q ?? ""}\u0000${search.sourceKey ?? ""}`;
}

export function hasPendingAuditDraftFilters(
  search: Pick<AuditListParams, "q" | "sourceKey">,
  draft: AuditDraftFilters
) {
  const normalizedDraft = normalizeAuditDraftFilters(draft);

  return (
    normalizedDraft.q !== search.q ||
    normalizedDraft.sourceKey !== search.sourceKey
  );
}

export function buildAuditListParamsWithDraft(
  search: AuditListParams,
  draft: AuditDraftFilters,
  next: Partial<AuditListParams>
): AuditListParams {
  return auditListParamsSchema.parse(
    clearIncompatibleAuditActionName({
      ...search,
      ...normalizeAuditDraftFilters(draft),
      ...next,
    })
  );
}
