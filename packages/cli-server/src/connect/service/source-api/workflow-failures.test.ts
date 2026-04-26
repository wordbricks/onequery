import { describe, expect, test } from "bun:test";

import {
  toCliDescriptorResolutionProblemKey,
  toCliPageFetchProblemKey,
  toCliRequestPreparationProblemKey,
} from "./workflow-failures";

describe("source api workflow failure mappings", () => {
  test("maps descriptor resolution failure codes to CLI problem keys", () => {
    expect(toCliDescriptorResolutionProblemKey("descriptor_unavailable")).toBe(
      "SOURCE_API_DESCRIBE_FAILED"
    );
    expect(toCliDescriptorResolutionProblemKey("permission_denied")).toBe(
      "SOURCE_API_FORBIDDEN"
    );
  });

  test("maps request preparation failure codes to CLI problem keys", () => {
    expect(toCliRequestPreparationProblemKey("invalid_request")).toBe(
      "SOURCE_API_REQUEST_INVALID"
    );
    expect(toCliRequestPreparationProblemKey("permission_denied")).toBe(
      "SOURCE_API_FORBIDDEN"
    );
    expect(toCliRequestPreparationProblemKey("execution_state_invalid")).toBe(
      "SOURCE_API_EXECUTION_STATE_INVALID"
    );
  });

  test("maps page fetch failure codes to CLI problem keys", () => {
    expect(toCliPageFetchProblemKey("invalid_request")).toBe(
      "SOURCE_API_REQUEST_INVALID"
    );
    expect(toCliPageFetchProblemKey("request_timed_out")).toBe(
      "SOURCE_API_EXECUTION_TIMED_OUT"
    );
    expect(toCliPageFetchProblemKey("execution_failed")).toBe(
      "SOURCE_API_EXECUTION_FAILED"
    );
    expect(toCliPageFetchProblemKey("execution_state_invalid")).toBe(
      "SOURCE_API_EXECUTION_STATE_INVALID"
    );
  });
});
