import { listSourceApiJsonPaths } from "./json-paths";
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
  const selectorTemplate = normalizeOptionalString(plan.selectorTemplate);
  const headerNames = normalizeSourceApiHeaderNames(plan.headers);
  const bodyKind = plan.body.kind;
  const bodyPaths = readSourceApiBodyPaths(plan);

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
      bodyPaths,
      headerNames,
      host: new URL(plan.url).host,
      method,
      selector,
      selectorTemplate: selectorTemplate ?? "/{path}",
    };
  }

  const method = normalizeOptionalString(plan.method)?.toUpperCase();
  if (!method) {
    throw new Error(
      `Structured source API plan "${plan.operation}" is missing a method`
    );
  }

  return {
    ...plan,
    bodyKind,
    bodyPaths,
    headerNames,
    method,
    selector,
    selectorTemplate,
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

function readSourceApiBodyPaths(
  plan: UnfingerprintedNormalizedExecutionPlan
): string[] {
  if (plan.kind === "structured_request") {
    return listSourceApiJsonPaths(plan.request);
  }

  if (plan.body.kind !== "json") {
    return [];
  }

  return listSourceApiJsonPaths(plan.body.value);
}
