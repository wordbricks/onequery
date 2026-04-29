import { describe, expect, it } from "vitest";

import type { SourceApiActionCommandPayload } from "../../../audit";
import {
  normalizeSourceApiActionCommandPayloadForStorage,
  SOURCE_API_ACTION_DETAIL_MAX_LENGTH,
} from "./workflow-runtime";

describe("normalizeSourceApiActionCommandPayloadForStorage", () => {
  it("caps terminal page fetch failure details before storage", () => {
    const payload: SourceApiActionCommandPayload = {
      attemptNumber: 1,
      detail: "x".repeat(SOURCE_API_ACTION_DETAIL_MAX_LENGTH + 100),
      failureCode: "execution_failed",
      kind: "terminal_failure",
      pageIndex: 0,
      type: "record_page_fetch",
    };

    const normalized =
      normalizeSourceApiActionCommandPayloadForStorage(payload);

    if (
      normalized.type !== "record_page_fetch" ||
      normalized.kind !== "terminal_failure"
    ) {
      throw new Error("expected terminal page fetch failure payload");
    }

    expect(normalized).not.toBe(payload);
    expect(normalized.detail.length).toBe(SOURCE_API_ACTION_DETAIL_MAX_LENGTH);
    expect(normalized.detail.endsWith(" [truncated]")).toBe(true);
  });

  it("keeps under-cap failure details unchanged", () => {
    const payload: SourceApiActionCommandPayload = {
      attemptNumber: 1,
      detail: "upstream timeout",
      failureCode: "request_timed_out",
      kind: "terminal_failure",
      pageIndex: 0,
      type: "record_page_fetch",
    };

    expect(normalizeSourceApiActionCommandPayloadForStorage(payload)).toBe(
      payload
    );
  });
});
