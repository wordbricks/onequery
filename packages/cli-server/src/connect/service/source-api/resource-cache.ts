import type { Database } from "@onequery/db/server";

import type { CliLoadSourceEffectResult } from "../../../domain/effects";
import { createWorkflowAuditFailure } from "../workflow-audit-failure";
import type { SourceApiServiceDependencies } from "./dependencies";

export type SourceApiSourceLookupCacheEntry = {
  organizationId: string;
  result: CliLoadSourceEffectResult;
  sourceKey: string;
};

export type SourceApiWorkflowResourceCache = {
  sourceLookup: SourceApiSourceLookupCacheEntry | null;
};

export function createEmptySourceApiWorkflowResourceCache(): SourceApiWorkflowResourceCache {
  return {
    sourceLookup: null,
  };
}

export function createSourceApiWorkflowResourceCacheFromLookup(input: {
  organizationId: string;
  sourceKey: string;
  sourceLookup: CliLoadSourceEffectResult | null;
}): SourceApiWorkflowResourceCache {
  if (input.sourceLookup === null) {
    return createEmptySourceApiWorkflowResourceCache();
  }

  return {
    sourceLookup: {
      organizationId: input.organizationId,
      result: input.sourceLookup,
      sourceKey: input.sourceKey,
    },
  };
}

export async function loadSourceApiSourceForWorkflow(input: {
  db: Database;
  dependencies: Pick<SourceApiServiceDependencies, "runCliLoadSourceEffect">;
  organizationId: string;
  resourceCache: SourceApiWorkflowResourceCache;
  sourceKey: string;
}): Promise<CliLoadSourceEffectResult> {
  const cached = input.resourceCache.sourceLookup;
  if (cached !== null) {
    if (
      cached.organizationId !== input.organizationId ||
      cached.sourceKey !== input.sourceKey
    ) {
      throw createSourceApiCacheProblem(
        "cached source_api_action source lookup does not match the requested effect"
      );
    }

    if (
      cached.result.kind === "found" &&
      (cached.result.source.organizationId !== input.organizationId ||
        cached.result.source.sourceKey !== input.sourceKey)
    ) {
      throw createSourceApiCacheProblem(
        "cached source_api_action source result does not match the requested effect"
      );
    }

    return cached.result;
  }

  return input.dependencies.runCliLoadSourceEffect({
    db: input.db,
    effect: {
      kind: "load_source",
      organizationId: input.organizationId,
      sourceKey: input.sourceKey,
    },
  });
}

function createSourceApiCacheProblem(detail: string, cause?: unknown) {
  return createWorkflowAuditFailure({
    cause,
    detail,
    keys: {
      corrupt: "SOURCE_API_WORKFLOW_CORRUPT",
      internal: "SOURCE_API_WORKFLOW_INTERNAL",
    },
  });
}
