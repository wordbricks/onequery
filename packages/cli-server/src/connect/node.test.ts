import { MethodOptions_IdempotencyLevel } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { CliService } from "./gen/onequery/cli/v1/cli_pb";
import { listCliConnectMountedRequestPaths } from "./node";

describe("cli connect node integration", () => {
  it("builds the mounted request paths explicitly", () => {
    const requestPaths = listCliConnectMountedRequestPaths({
      requestPathPrefix: "/api/cli",
    });

    expect(requestPaths).toContain(
      "/api/cli/onequery.cli.v1.CliService/GetSession"
    );
    expect(requestPaths).toContain(
      "/api/cli/onequery.cli.v1.CliService/ExecuteQuery"
    );
  });

  it("marks the safe read RPCs as side-effect free", () => {
    expect(CliService.method.describeSourceApi.idempotency).toBe(
      MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS
    );
    expect(CliService.method.getSession.idempotency).toBe(
      MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS
    );
    expect(CliService.method.listOrganizations.idempotency).toBe(
      MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS
    );
    expect(CliService.method.getOrganization.idempotency).toBe(
      MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS
    );
    expect(CliService.method.listSources.idempotency).toBe(
      MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS
    );
    expect(CliService.method.getSourceConnectGuide.idempotency).toBe(
      MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS
    );
    expect(CliService.method.getSource.idempotency).toBe(
      MethodOptions_IdempotencyLevel.NO_SIDE_EFFECTS
    );
    expect(CliService.method.refreshSession.idempotency).toBe(
      MethodOptions_IdempotencyLevel.IDEMPOTENCY_UNKNOWN
    );
    expect(CliService.method.connectSource.idempotency).toBe(
      MethodOptions_IdempotencyLevel.IDEMPOTENCY_UNKNOWN
    );
    expect(CliService.method.executeQuery.idempotency).toBe(
      MethodOptions_IdempotencyLevel.IDEMPOTENCY_UNKNOWN
    );
  });
});
