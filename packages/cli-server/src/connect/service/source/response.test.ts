import {
  SourceInterface,
  SourceStatus,
} from "@onequery/proto-cli/cli/v1/source_pb";
import { describe, expect, it } from "vitest";

import { buildCliSource } from "./response";

describe("source response codec", () => {
  it("keeps query interfaces visible on errored database sources", () => {
    expect(
      buildCliSource({
        displayName: null,
        provider: "postgres",
        sourceKey: "broken_warehouse",
        status: "error",
      })
    ).toMatchObject({
      interfaces: [SourceInterface.QUERY],
      sourceKey: "broken_warehouse",
      status: SourceStatus.ERROR,
    });
  });
});
