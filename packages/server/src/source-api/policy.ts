import { listSourceApiJsonPaths } from "./json-paths";
import type {
  PreparedSourceApiWithoutBinding,
  SourceApiHeader,
  UnboundPreparedSourceApi,
} from "./types";

export function finalizeSourceApiPolicyPlan(
  plan: UnboundPreparedSourceApi
): PreparedSourceApiWithoutBinding {
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
        `HTTP prepared source API "${plan.operation}" is missing a method`
      );
    }

    return {
      ...plan,
      bodyKind,
      bodyPaths,
      headerNames,
      host: new URL(plan.url).hostname,
      method,
      selector,
      selectorTemplate: selectorTemplate ?? "/{path}",
    };
  }

  const method = normalizeOptionalString(plan.method)?.toUpperCase();
  if (!method) {
    throw new Error(
      `Structured prepared source API "${plan.operation}" is missing a method`
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

function readSourceApiBodyPaths(plan: UnboundPreparedSourceApi): string[] {
  if (plan.kind === "structured_request") {
    return listSourceApiJsonPaths(plan.request);
  }

  if (plan.body.kind !== "json") {
    return [];
  }

  return listSourceApiJsonPaths(plan.body.value);
}
