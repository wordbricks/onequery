import { describe, expect, it } from "vitest";

import { WorkflowStorageCorruptRowError } from "../../audit";
import {
  createWorkflowAuditCorruptionFailure,
  createWorkflowAuditFailure,
} from "./workflow-audit-failure";

const queryWorkflowKeys = {
  corrupt: "QUERY_WORKFLOW_CORRUPT",
  internal: "QUERY_WORKFLOW_INTERNAL",
} as const;

describe("workflow audit failures", () => {
  it("classifies typed corrupt storage rows as workflow corruption", () => {
    const failure = createWorkflowAuditFailure({
      cause: new WorkflowStorageCorruptRowError({
        actionId: "query_action_1",
        entity: "workflow_event_history",
        family: "query_action",
      }),
      detail: "query_action replay failed",
      keys: queryWorkflowKeys,
    });

    expect({
      message: failure.message,
      reason: failure.reason,
    }).toEqual({
      message: "query_action replay failed",
      reason: "QUERY_WORKFLOW_CORRUPT",
    });
  });

  it("classifies untyped audit failures as internal workflow failures", () => {
    const failure = createWorkflowAuditFailure({
      cause: new Error("lease update failed"),
      detail: "query_action execute_query could not be stored",
      keys: queryWorkflowKeys,
    });

    expect({
      message: failure.message,
      reason: failure.reason,
    }).toEqual({
      message: "query_action execute_query could not be stored",
      reason: "QUERY_WORKFLOW_INTERNAL",
    });
  });

  it("keeps explicit replay corruption distinct from internal audit failures", () => {
    const failure = createWorkflowAuditCorruptionFailure({
      detail: "query_action stored result payload is corrupt",
      key: "QUERY_WORKFLOW_CORRUPT",
    });

    expect({
      message: failure.message,
      reason: failure.reason,
    }).toEqual({
      message: "query_action stored result payload is corrupt",
      reason: "QUERY_WORKFLOW_CORRUPT",
    });
  });
});
