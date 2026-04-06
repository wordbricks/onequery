import { create } from "@bufbuild/protobuf";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  CliAuthMode,
  GetSessionResponseSchema,
} from "./gen/onequery/cli/v1/auth_pb";
import { CliService } from "./gen/onequery/cli/v1/cli_pb";
import { honoConnectMiddleware } from "./middleware";

const CONNECT_JSON_HEADERS = {
  "Connect-Protocol-Version": "1",
  "content-type": "application/json",
};

function createTestApp(
  input: {
    onGetSession?: () => void;
    requestPathPrefix?: string;
  } = {}
) {
  const app = new Hono();

  app.use(
    "*",
    honoConnectMiddleware({
      connect: true,
      grpc: false,
      grpcWeb: false,
      requestPathPrefix: input.requestPathPrefix,
      routes(router) {
        router.service(CliService, {
          async getSession() {
            input.onGetSession?.();
            return create(GetSessionResponseSchema, {
              authMode: CliAuthMode.BROWSER_SESSION,
            });
          },
        });
      },
    })
  );

  return app;
}

describe("hono connect middleware", () => {
  it("matches only the configured request path prefix", async () => {
    const onGetSession = vi.fn();
    const app = createTestApp({
      onGetSession,
      requestPathPrefix: "/api/cli",
    });

    const matchedResponse = await app.request(
      "https://cli.example/api/cli/onequery.cli.v1.CliService/GetSession",
      {
        body: "{}",
        headers: CONNECT_JSON_HEADERS,
        method: "POST",
      }
    );

    expect(matchedResponse.status).toBe(200);
    expect(onGetSession).toHaveBeenCalledTimes(1);

    const unmatchedResponse = await app.request(
      "https://cli.example/api/cli/x/onequery.cli.v1.CliService/GetSession",
      {
        body: "{}",
        headers: CONNECT_JSON_HEADERS,
        method: "POST",
      }
    );

    expect(unmatchedResponse.status).toBe(404);
    expect(onGetSession).toHaveBeenCalledTimes(1);
  });
});
