import http from "node:http";

import {
  durationFromMs,
  MethodOptions_IdempotencyLevel,
} from "@bufbuild/protobuf/wkt";
import {
  Code,
  createClient,
  createContextValues,
  ConnectError,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { afterEach, describe, expect, it } from "vitest";

import type { CliConnectRequestContext } from "./context";
import { cliConnectRequestContextKey } from "./context";
import { BadRequestSchema } from "./gen/google/rpc/error_details_pb";
import { CliService } from "./gen/onequery/cli/v1/cli_pb";
import {
  CliErrorDetailSchema,
  ProblemCode,
  ProblemStage,
  SupportActionKind,
} from "./gen/onequery/cli/v1/common_pb";
import {
  createCliConnectHandler,
  listCliConnectMountedRequestPaths,
} from "./node-adapter";

const openServers = new Set<http.Server>();

afterEach(async () => {
  await Promise.all([...openServers].map(closeServer));
  openServers.clear();
});

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

  it("normalizes protovalidate failures into typed cli connect problems", async () => {
    const server = http.createServer(
      createCliConnectHandler({
        contextValues(request) {
          const requestIdHeader = request.headers["x-request-id"];
          const requestId = Array.isArray(requestIdHeader)
            ? requestIdHeader[0]
            : requestIdHeader;

          return createContextValues().set(cliConnectRequestContextKey, {
            honoContext: null,
            requestId: requestId ?? "unknown",
            resolveAuthorizedOrg: async () => {
              throw new Error("validation test should not resolve org access");
            },
            resolveSession: async () => {
              throw new Error("validation test should not resolve session");
            },
          } as unknown as CliConnectRequestContext);
        },
      })
    );
    openServers.add(server);
    const port = await listen(server);
    const client = createClient(
      CliService,
      createConnectTransport({
        baseUrl: `http://127.0.0.1:${port}`,
        httpVersion: "1.1",
      })
    );

    try {
      await client.validateQuery(
        {
          orgSlug: "Bad!",
          query: {
            cellMaxChars: 32,
            maxBytes: 1024,
            maxRows: 10,
            sql: "select 1",
            timeout: durationFromMs(1000),
          },
          sourceKey: "source-1",
        },
        {
          headers: {
            "x-request-id": "req_cli_validation",
          },
        }
      );
    } catch (error) {
      const connectError = ConnectError.from(error);
      const cliDetails = connectError.findDetails(CliErrorDetailSchema);
      const badRequestDetails = connectError.findDetails(BadRequestSchema);

      expect(connectError.code).toBe(Code.InvalidArgument);
      expect(cliDetails).toHaveLength(1);
      expect(cliDetails[0]).toMatchObject({
        code: ProblemCode.INVALID_REQUEST,
        hint: "correct the query input and retry",
        requestId: "req_cli_validation",
        stage: ProblemStage.READ_QUERY_INPUT,
        support: {
          explainSlug: "invalid_request",
          kind: SupportActionKind.NONE,
          reason: "user_actionable",
        },
        title: "Invalid Request",
      });
      expect(badRequestDetails).toHaveLength(1);
      expect(badRequestDetails[0]?.fieldViolations.length).toBeGreaterThan(0);
      expect(connectError.metadata.get("x-request-id")).toBe(
        "req_cli_validation"
      );
      return;
    }

    throw new Error("expected validateQuery to reject");
  });

  it("rejects invalid nested pagination requests before the handler runs", async () => {
    const server = http.createServer(
      createCliConnectHandler({
        contextValues(request) {
          const requestIdHeader = request.headers["x-request-id"];
          const requestId = Array.isArray(requestIdHeader)
            ? requestIdHeader[0]
            : requestIdHeader;

          return createContextValues().set(cliConnectRequestContextKey, {
            honoContext: null,
            requestId: requestId ?? "unknown",
            resolveAuthorizedOrg: async () => {
              throw new Error("pagination validation should not resolve org");
            },
            resolveSession: async () => {
              throw new Error(
                "pagination validation should not resolve session"
              );
            },
          } as unknown as CliConnectRequestContext);
        },
      })
    );
    openServers.add(server);
    const port = await listen(server);
    const client = createClient(
      CliService,
      createConnectTransport({
        baseUrl: `http://127.0.0.1:${port}`,
        httpVersion: "1.1",
      })
    );

    try {
      await client.listOrganizations(
        {
          page: {
            limit: 0,
          },
        },
        {
          headers: {
            "x-request-id": "req_cli_page_validation",
          },
        }
      );
    } catch (error) {
      const connectError = ConnectError.from(error);
      const cliDetails = connectError.findDetails(CliErrorDetailSchema);
      const badRequestDetails = connectError.findDetails(BadRequestSchema);

      expect(connectError.code).toBe(Code.InvalidArgument);
      expect(cliDetails).toHaveLength(1);
      expect(cliDetails[0]).toMatchObject({
        code: ProblemCode.INVALID_REQUEST,
        hint: "correct the org request and retry",
        requestId: "req_cli_page_validation",
        stage: ProblemStage.RESOLVE_ORG,
        support: {
          explainSlug: "invalid_request",
          kind: SupportActionKind.NONE,
          reason: "user_actionable",
        },
        title: "Invalid Request",
      });
      expect(badRequestDetails).toHaveLength(1);
      expect(badRequestDetails[0]?.fieldViolations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: "page.limit",
          }),
        ])
      );
      return;
    }

    throw new Error("expected listOrganizations to reject");
  });
});

function listen(server: http.Server) {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("expected server to bind to a TCP port"));
        return;
      }

      resolve(address.port);
    });
  });
}

function closeServer(server: http.Server) {
  return new Promise<void>((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
