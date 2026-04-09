import type {
  FinalizedNormalizedExecutionPlan,
  SourceApiHeader,
  UnfingerprintedNormalizedExecutionPlan,
} from "./types";

export function finalizeSourceApiPolicyPlan(
  plan: UnfingerprintedNormalizedExecutionPlan
): FinalizedNormalizedExecutionPlan {
  // Keep policy-relevant metadata canonical in one place so authorization
  // never depends on adapter-specific field shaping.
  const selector = normalizeOptionalString(plan.selector);
  const headerNames = normalizeSourceApiHeaderNames(plan.headers);
  const bodyKind = plan.body.kind;

  if (plan.kind === "http_request") {
    const method = normalizeOptionalString(plan.method)?.toUpperCase();
    if (!method) {
      throw new Error(
        `HTTP source API plan "${plan.operation}" is missing a method`
      );
    }

    return {
      ...plan,
      bodyKind,
      headerNames,
      method,
      selector,
    };
  }

  return {
    ...plan,
    bodyKind,
    headerNames,
    method: normalizeOptionalString(plan.method)?.toUpperCase(),
    selector,
  };
}

export function normalizeSourceApiHeaderNames(
  headers: readonly SourceApiHeader[]
): string[] {
  const dedupedHeaderNames = new Set<string>();
  for (const header of headers) {
    const normalizedName = normalizeOptionalString(header.name)?.toLowerCase();
    if (normalizedName) {
      dedupedHeaderNames.add(normalizedName);
    }
  }

  return [...dedupedHeaderNames];
}

function normalizeOptionalString(
  value: string | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
