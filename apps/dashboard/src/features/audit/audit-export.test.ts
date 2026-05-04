import { describe, expect, it } from "vitest";

import { buildAuditCsv } from "./audit-export";
import { createAuditListItem } from "./audit-test-fixtures";

describe("buildAuditCsv", () => {
  it("exports stable full identifiers instead of table display labels", () => {
    const traceId = "trace-1234567890abcdef";
    const csv = buildAuditCsv([
      createAuditListItem({
        id: traceId,
        requestId: "request-1234567890abcdef",
      }),
    ]);

    expect(csv).toContain("request-1234567890abcdef");
    expect(csv).toContain(traceId);
  });
});
