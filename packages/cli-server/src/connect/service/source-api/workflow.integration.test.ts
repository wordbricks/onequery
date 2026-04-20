import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  asc,
  createDb,
  organization,
  prepareApplicationDatabase,
  sourceApiActionEvents,
  workflowCommands,
  workflowEffectDispatches,
} from "@onequery/db/server";
import {
  createSourceApiPreview,
  decodeSourceApiContinuationToken,
  encodeSourceApiContinuationToken,
} from "@onequery/server/source-api";
import type { Result as ResultType } from "better-result";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkflowActorSnapshot } from "../../../audit";
import type { SourceApiServiceDependencies } from "./dependencies";
import {
  runDescribeSourceApiWorkflowResult,
  runResumeSourceApiExecuteWorkflowResult,
  runStartSourceApiExecuteWorkflowResult,
} from "./workflow";

type ClosableDatabase = {
  $client?: {
    close?: () => Promise<unknown>;
    end?: (options?: Record<string, unknown>) => Promise<unknown>;
  };
};

const migrationsFolder = fileURLToPath(
  new URL("../../../../../db/src/migrations", import.meta.url)
);

const actorSnapshot: WorkflowActorSnapshot = {
  authMode: "browser_session",
  email: "jane@example.com",
  membershipRoles: ["owner"],
  userId: "user_1",
};

const actor = {
  capabilities: ["source_api.describe", "source_api.execute"],
  membershipRoles: ["owner"],
  organizationId: "org_1",
  organizationSlug: "org-one",
  requestId: "req-source-api-1",
  userId: "user_1",
} as const;

const org = {
  id: "org_1",
  name: "Org One",
  slug: "org-one",
} as const;

const loadedSource = {
  kind: "found",
  source: {
    credentialsEncrypted: "encrypted",
    credentialsIv: "iv",
    displayName: "GitHub Prod",
    id: "source_1",
    name: "github-prod",
    organizationId: org.id,
    provider: "github",
    sourceKey: "github-prod",
    status: "active",
  },
} as const;

const preparedSource = {
  credentials: {
    token: "secret",
  },
  displayName: "GitHub Prod",
  id: "source_1",
  provider: "github",
  sourceKey: "github-prod",
} as const;

const descriptor = {
  defaultPathOperation: "fetch",
  descriptorVersion: "github-v1",
  examples: [],
  notes: ["Uses the GitHub REST API."],
  operations: [
    {
      description: "Fetch one GitHub API path.",
      examples: [],
      fieldPolicy: {
        acceptsInput: false,
        allowsRawFields: false,
        allowsTypedFields: false,
        inputMode: "none",
        mergePatches: false,
        supportsArrayPaths: false,
        supportsNestedPaths: false,
      },
      headerPolicy: {
        allowedRequestHeaders: ["accept"],
        allowedResponseHeaders: ["content-type"],
      },
      kind: "http_request",
      methodPolicy: {
        allowedMethods: ["GET"],
        defaultMethod: "GET",
      },
      name: "fetch",
      notes: [],
      paginationPolicy: "continuation_token",
      selectorKind: "path",
      selectorLabel: "path",
      summary: "Fetch a GitHub path",
    },
  ],
  source: {
    displayName: "GitHub Prod",
    provider: "github",
    sourceKey: "github-prod",
  },
} as const;

const previewPrepared = {
  body: {
    kind: "none",
  },
  bodyKind: "none",
  bodyPaths: [],
  descriptorVersion: "github-v1",
  headerNames: ["accept"],
  headers: [],
  host: "api.github.com",
  kind: "http_request",
  method: "GET",
  operation: "fetch",
  paginationPolicy: "none",
  preparedBinding: "prepared_preview",
  provider: "github",
  selector: "/issues",
  selectorTemplate: "/{path}",
  sourceId: "source_1",
  sourceKey: "github-prod",
  url: "https://api.github.com/issues",
} as const;

const executePrepared = {
  ...previewPrepared,
  paginationPolicy: "continuation_token",
  preparedBinding: "prepared_execute",
} as const;

const firstPageResult = {
  body: {
    kind: "text",
    value: "page-1",
  },
  contentType: "text/plain",
  headers: [
    {
      name: "content-type",
      value: "text/plain",
    },
  ],
  nextContinuationState: {
    cursor: "page_2",
  },
  operation: "fetch",
  selector: "/issues",
  source: {
    displayName: "GitHub Prod",
    provider: "github",
    sourceKey: "github-prod",
  },
  status: 200,
} as const;

const finalPageResult = {
  body: {
    kind: "text",
    value: "page-2",
  },
  contentType: "text/plain",
  headers: [
    {
      name: "content-type",
      value: "text/plain",
    },
  ],
  operation: "fetch",
  selector: "/issues?page=2",
  source: {
    displayName: "GitHub Prod",
    provider: "github",
    sourceKey: "github-prod",
  },
  status: 200,
} as const;

async function closeDatabase(db: ClosableDatabase): Promise<void> {
  const client = db.$client;
  if (client && typeof client.close === "function") {
    await client.close();
    return;
  }

  if (client && typeof client.end === "function") {
    await client.end({ timeout: 0 });
  }
}

async function createTestDb() {
  const connectionString = `pglite:${join(tmpdir(), "pglite", randomUUID())}`;
  await prepareApplicationDatabase({
    connectionString,
    migrationsFolder,
  });
  const db = createDb(connectionString);

  await db.insert(organization).values(org);

  return db;
}

function unwrapOk<T, E>(value: ResultType<T, E>) {
  expect(value.isOk()).toBe(true);
  if (value.isErr()) {
    throw value.error;
  }

  return value.value;
}

function createDependencies(
  overrides: Partial<SourceApiServiceDependencies> = {}
): SourceApiServiceDependencies {
  return {
    buildCliRequestLogDetails: vi.fn(() => ({
      method: "POST",
      path: "/connectrpc/onequery.cli.v1.CliService/ExecuteSourceApi",
      requestId: actor.requestId,
    })),
    createSourceApiPreview,
    decodeSourceApiContinuationToken,
    describeSourceApi: vi.fn().mockResolvedValue(descriptor),
    encodeSourceApiContinuationToken,
    executePreparedSourceApi: vi.fn().mockResolvedValue(firstPageResult),
    getCliLogLevelForStatus: vi.fn((): "info" => "info"),
    logCliEvent: vi.fn(),
    prepareDataSourceCredentials: vi.fn().mockResolvedValue(
      Result.ok({
        credentials: preparedSource.credentials,
        refreshed: false,
      })
    ),
    prepareSourceApiDraft: vi.fn().mockResolvedValue(executePrepared),
    runCliLoadSourceEffect: vi.fn().mockResolvedValue(loadedSource),
    toCliErrorMessage: vi.fn((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    ),
    ...overrides,
  };
}

function createWorkflowContext(
  db: ReturnType<typeof createDb>,
  requestId: string
) {
  return {
    actor: {
      ...actor,
      requestId,
    },
    actorSnapshot,
    c: {
      var: {
        runtime: {
          crypto: {
            masterEncryptionKey: "master-key",
          },
        },
        storage: {
          db,
        },
      },
    } as never,
    organizationId: org.id,
    orgSlug: org.slug,
    requestId,
  };
}

describe("source api workflow audit runtime", () => {
  const openedDatabases: ClosableDatabase[] = [];

  afterEach(async () => {
    for (const db of openedDatabases.splice(0)) {
      await closeDatabase(db);
    }
  });

  it("records describeSourceApi through source_api_action storage", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);
    const dependencies = createDependencies({
      prepareSourceApiDraft: vi.fn().mockResolvedValue(previewPrepared),
    });

    const result = await runDescribeSourceApiWorkflowResult({
      ...createWorkflowContext(db, "req-describe-1"),
      dependencies,
      sourceKey: "github-prod",
    });

    const descriptorResult = unwrapOk(result);
    const commandRows = await db
      .select()
      .from(workflowCommands)
      .orderBy(asc(workflowCommands.createdAt), asc(workflowCommands.id));
    const actionRow = await db.query.sourceApiActions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, org.id),
    });
    const eventRows = await db
      .select()
      .from(sourceApiActionEvents)
      .orderBy(asc(sourceApiActionEvents.sequence));
    const outboxRows = await db
      .select()
      .from(workflowEffectDispatches)
      .orderBy(
        asc(workflowEffectDispatches.createdAt),
        asc(workflowEffectDispatches.id)
      );

    expect(descriptorResult).toMatchObject({
      descriptorVersion: "github-v1",
      source: {
        provider: "github",
        sourceKey: "github-prod",
      },
    });
    expect(commandRows.map((row) => row.commandType)).toEqual([
      "start_describe",
      "record_source_lookup",
      "record_descriptor_resolution",
    ]);
    expect(actionRow).toMatchObject({
      attemptNumber: null,
      failureCode: null,
      invokeMode: null,
      outcome: "succeeded",
      phase: "completed",
      requestKind: "describe",
    });
    expect(eventRows.map((row) => row.eventType)).toEqual([
      "action_received",
      "source_loaded",
      "descriptor_resolved",
    ]);
    expect(
      outboxRows.map((row) => ({
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([
      { effectType: "load_source", status: "completed" },
      { effectType: "resolve_descriptor", status: "completed" },
    ]);
  });

  it("records preview-only invoke through source_api_action storage", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);
    const dependencies = createDependencies({
      prepareSourceApiDraft: vi.fn().mockResolvedValue(previewPrepared),
    });

    const result = await runStartSourceApiExecuteWorkflowResult({
      ...createWorkflowContext(db, "req-preview-1"),
      dependencies,
      draft: {
        body: {
          kind: "none",
        },
        headers: [],
        operation: "fetch",
        selector: "/issues",
      },
      invokeMode: "preview_only",
      sourceKey: "github-prod",
    });

    const preview = unwrapOk(result);
    const commandRows = await db
      .select()
      .from(workflowCommands)
      .orderBy(asc(workflowCommands.createdAt), asc(workflowCommands.id));
    const actionRow = await db.query.sourceApiActions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, org.id),
    });
    const eventRows = await db
      .select()
      .from(sourceApiActionEvents)
      .orderBy(asc(sourceApiActionEvents.sequence));
    const outboxRows = await db
      .select()
      .from(workflowEffectDispatches)
      .orderBy(
        asc(workflowEffectDispatches.createdAt),
        asc(workflowEffectDispatches.id)
      );

    expect(preview.preview).toMatchObject({
      kind: "http_request",
      operation: "fetch",
      paginationPolicy: "none",
    });
    expect(preview.continuationToken).toBeUndefined();
    expect(preview.result).toBeUndefined();
    expect(commandRows.map((row) => row.commandType)).toEqual([
      "start_invoke",
      "record_source_lookup",
      "record_descriptor_resolution",
      "record_request_preparation",
    ]);
    expect(actionRow).toMatchObject({
      attemptNumber: null,
      failureCode: null,
      invokeMode: "preview_only",
      outcome: "succeeded",
      phase: "completed",
      preparedRequestFingerprint: "prepared_preview",
      requestKind: "invoke",
    });
    expect(eventRows.map((row) => row.eventType)).toEqual([
      "action_received",
      "source_loaded",
      "descriptor_resolved",
      "request_prepared",
    ]);
    expect(
      outboxRows.map((row) => ({
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([
      { effectType: "load_source", status: "completed" },
      { effectType: "resolve_descriptor", status: "completed" },
      { effectType: "prepare_request", status: "completed" },
    ]);
  });

  it("records execute plus resume on the same source_api_action", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);
    const dependencies = createDependencies({
      executePreparedSourceApi: vi
        .fn()
        .mockResolvedValueOnce(firstPageResult)
        .mockResolvedValueOnce(finalPageResult),
    });

    const startResult = await runStartSourceApiExecuteWorkflowResult({
      ...createWorkflowContext(db, "req-execute-1"),
      dependencies,
      draft: {
        body: {
          kind: "none",
        },
        headers: [],
        operation: "fetch",
        selector: "/issues",
      },
      invokeMode: "execute",
      sourceKey: "github-prod",
    });
    const started = unwrapOk(startResult);
    const actionAfterStart = await db.query.sourceApiActions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, org.id),
    });
    const decodedContinuation = decodeSourceApiContinuationToken({
      now: new Date("2026-04-20T09:00:30.000Z"),
      secret: "master-key",
      token: started.continuationToken ?? "",
    });

    expect(actionAfterStart).toMatchObject({
      attemptNumber: 1,
      failureCode: null,
      outcome: "pending",
      phase: "await_resume",
      preparedRequestFingerprint: "prepared_execute",
    });
    expect(decodedContinuation).toMatchObject({
      actionId: actionAfterStart?.id,
      preparedRequestFingerprint: "prepared_execute",
      resumeFromEventId: actionAfterStart?.lastEventId,
      state: {
        cursor: "page_2",
      },
      version: 3,
    });

    const resumeResult = await runResumeSourceApiExecuteWorkflowResult({
      ...createWorkflowContext(db, "req-resume-1"),
      continuation: decodedContinuation,
      dependencies,
      source: preparedSource as never,
    });

    const resumed = unwrapOk(resumeResult);
    const commandRows = await db
      .select()
      .from(workflowCommands)
      .orderBy(asc(workflowCommands.createdAt), asc(workflowCommands.id));
    const actionRow = await db.query.sourceApiActions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, org.id),
    });
    const eventRows = await db
      .select()
      .from(sourceApiActionEvents)
      .orderBy(asc(sourceApiActionEvents.sequence));
    const outboxRows = await db
      .select()
      .from(workflowEffectDispatches)
      .orderBy(
        asc(workflowEffectDispatches.createdAt),
        asc(workflowEffectDispatches.id)
      );

    expect(resumed).toMatchObject({
      continuationToken: undefined,
      preview: {
        operation: "fetch",
        paginationPolicy: "continuation_token",
      },
      result: {
        selector: "/issues?page=2",
        status: 200,
      },
    });
    expect(commandRows.map((row) => row.commandType)).toEqual([
      "start_invoke",
      "record_source_lookup",
      "record_descriptor_resolution",
      "record_request_preparation",
      "record_page_fetch",
      "resume_invoke",
      "record_page_fetch",
    ]);
    expect(actionRow).toMatchObject({
      attemptNumber: 2,
      failureCode: null,
      outcome: "succeeded",
      phase: "completed",
      preparedRequestFingerprint: "prepared_execute",
    });
    expect(eventRows.map((row) => row.eventType)).toEqual([
      "action_received",
      "source_loaded",
      "descriptor_resolved",
      "request_prepared",
      "page_fetch_succeeded",
      "resume_requested",
      "page_fetch_succeeded",
    ]);
    expect(
      outboxRows.map((row) => ({
        effectType: row.effectType,
        status: row.status,
      }))
    ).toEqual([
      { effectType: "load_source", status: "completed" },
      { effectType: "resolve_descriptor", status: "completed" },
      { effectType: "prepare_request", status: "completed" },
      { effectType: "execute_page", status: "completed" },
      { effectType: "execute_page", status: "completed" },
    ]);
  });

  it("records terminal source api failures as page_fetch_failed", async () => {
    const db = await createTestDb();
    openedDatabases.push(db as ClosableDatabase);
    const dependencies = createDependencies({
      executePreparedSourceApi: vi
        .fn()
        .mockRejectedValue(new Error("GitHub upstream request failed")),
    });

    const result = await runStartSourceApiExecuteWorkflowResult({
      ...createWorkflowContext(db, "req-failure-1"),
      dependencies,
      draft: {
        body: {
          kind: "none",
        },
        headers: [],
        operation: "fetch",
        selector: "/issues",
      },
      invokeMode: "execute",
      sourceKey: "github-prod",
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error("expected failed source api execution");
    }

    const actionRow = await db.query.sourceApiActions.findFirst({
      where: (table, { eq }) => eq(table.organizationId, org.id),
    });
    const eventRows = await db
      .select()
      .from(sourceApiActionEvents)
      .orderBy(asc(sourceApiActionEvents.sequence));

    expect(actionRow).toMatchObject({
      attemptNumber: 1,
      failureCode: "execution_failed",
      outcome: "failed",
      phase: "completed",
    });
    expect(eventRows.map((row) => row.eventType)).toEqual([
      "action_received",
      "source_loaded",
      "descriptor_resolved",
      "request_prepared",
      "page_fetch_failed",
    ]);
  });
});
