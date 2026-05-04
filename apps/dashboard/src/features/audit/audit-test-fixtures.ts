import type { AuditListItem } from "@onequery/audit-contracts/audit";

export function createAuditListItem(
  input: {
    familyActionId?: string;
    id?: string;
    requestId?: string;
  } = {}
): AuditListItem {
  return {
    actionName: "execute",
    completedAt: null,
    failureCode: null,
    family: "query_action",
    familyActionId: input.familyActionId ?? "query-action-1",
    id: input.id ?? "audit-1",
    lastEventAt: "2026-01-01T00:00:00.000Z",
    lastEventType: "query_executed",
    metrics: {
      elapsedMs: 12,
      rowCount: 3,
    },
    originActor: {
      authMode: null,
      email: "operator@example.com",
      membershipRoles: [],
      userId: "user-1",
    },
    originSurface: "dashboard",
    outcome: "succeeded",
    phase: "completed",
    preview: {
      elapsedMs: 12,
      errorDetail: null,
      errorHint: null,
      queryText: "select 1",
      rowCount: 3,
      usageRecordingStatus: "succeeded",
      validatedQuery: null,
    },
    requestId: input.requestId ?? "request-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    subtitle: "Query executed",
    target: {
      displayName: "Warehouse",
      provider: "postgres",
      sourceId: "source-1",
      sourceKey: "warehouse",
      sourceName: "Warehouse",
    },
    title: "Execute query",
  };
}
