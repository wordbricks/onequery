import type { DatabaseCredentials } from "@onequery/db/server";

import type {
  CliLoadSourceEffect,
  CliLoadSourceEffectResult,
} from "../../../domain/effects";
import { createWorkflowAuditFailure } from "../workflow-audit-failure";

export type CachedQuerySourceLookup = {
  organizationId: string;
  result: CliLoadSourceEffectResult;
  sourceKey: string;
};

export type QueryWorkflowResourceCache = {
  credentials: DatabaseCredentials | null;
  sourceLookup: CachedQuerySourceLookup | null;
};

type CacheUse = "execution effect" | "preparation effect";

type SourceLookupTarget = {
  organizationId: string;
  sourceKey: string;
};

type SourceLookupDispatch = {
  loadSource: (
    effect: CliLoadSourceEffect
  ) => Promise<CliLoadSourceEffectResult>;
};

export function createEmptyQueryWorkflowResourceCache(): QueryWorkflowResourceCache {
  return {
    credentials: null,
    sourceLookup: null,
  };
}

export function createQueryWorkflowResourceCache(input: {
  organizationId: string;
  sourceKey: string;
  sourceLookup: CliLoadSourceEffectResult | null;
}): QueryWorkflowResourceCache {
  return {
    credentials: null,
    sourceLookup:
      input.sourceLookup === null
        ? null
        : {
            organizationId: input.organizationId,
            result: input.sourceLookup,
            sourceKey: input.sourceKey,
          },
  };
}

export async function loadQuerySourceLookup(
  input: SourceLookupTarget & {
    cached: CachedQuerySourceLookup | null;
    dispatch: SourceLookupDispatch;
    use: CacheUse;
  }
): Promise<CachedQuerySourceLookup> {
  if (input.cached !== null) {
    const cached = input.cached;
    readCachedQuerySourceLookup({
      cached,
      organizationId: input.organizationId,
      sourceKey: input.sourceKey,
      use: input.use,
    });
    return cached;
  }

  return {
    organizationId: input.organizationId,
    result: await input.dispatch.loadSource({
      kind: "load_source",
      organizationId: input.organizationId,
      sourceKey: input.sourceKey,
    }),
    sourceKey: input.sourceKey,
  };
}

export function readCachedQuerySourceLookup(
  input: SourceLookupTarget & {
    cached: CachedQuerySourceLookup;
    use: CacheUse;
  }
): CliLoadSourceEffectResult {
  if (
    input.cached.organizationId !== input.organizationId ||
    input.cached.sourceKey !== input.sourceKey
  ) {
    throw createQueryCacheProblem(
      `cached query source lookup does not match ${input.use}`
    );
  }

  if (
    input.cached.result.kind === "found" &&
    (input.cached.result.source.organizationId !== input.organizationId ||
      input.cached.result.source.sourceKey !== input.sourceKey)
  ) {
    throw createQueryCacheProblem(
      `cached query source result does not match ${input.use}`
    );
  }

  return input.cached.result;
}

function createQueryCacheProblem(detail: string, cause?: unknown) {
  return createWorkflowAuditFailure({
    cause,
    detail,
    keys: {
      corrupt: "QUERY_WORKFLOW_CORRUPT",
      internal: "QUERY_WORKFLOW_INTERNAL",
    },
  });
}
