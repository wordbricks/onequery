import { createServer } from "node:net";

import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serveWithNode, serveWithNodeResult } from "./node-serve";

describe("serveWithNode", () => {
  let startedServer: Awaited<ReturnType<typeof serveWithNode>> | undefined;

  afterEach(async () => {
    if (startedServer) {
      await startedServer.stop(true);
      startedServer = undefined;
    }
  });

  it("passes node bindings through to Hono handlers", async () => {
    const seenBindings = vi.fn();
    const app = new Hono<{
      Bindings: {
        incoming: { httpVersion: string };
        outgoing: object;
      };
    }>();

    app.get("/health", (c) => {
      seenBindings({
        hasIncoming: Boolean(c.env.incoming),
        hasOutgoing: Boolean(c.env.outgoing),
        httpVersion: c.env.incoming.httpVersion,
      });

      return c.json({
        httpVersion: c.env.incoming.httpVersion,
        ok: true,
      });
    });

    startedServer = await serveWithNode({
      fetch: app.fetch.bind(app),
      hostname: "127.0.0.1",
      idleTimeout: 1,
      port: 0,
    });

    const response = await fetch(
      `http://${startedServer.hostname}:${startedServer.port}/health`
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      httpVersion: "1.1",
      ok: true,
    });
    expect(seenBindings).toHaveBeenCalledWith({
      hasIncoming: true,
      hasOutgoing: true,
      httpVersion: "1.1",
    });
  });

  it("returns a listen error when the configured port is already occupied", async () => {
    const blocker = createServer();

    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", () => {
        blocker.removeListener("error", reject);
        resolve();
      });
    });

    try {
      const address = blocker.address();
      const port =
        address && typeof address === "object" ? address.port : undefined;

      if (port === undefined) {
        throw new Error("expected blocker server to report a listening port");
      }

      const result = await serveWithNodeResult({
        fetch: () => new Response("ok"),
        hostname: "127.0.0.1",
        idleTimeout: 1,
        port,
      });

      expect(result.isErr()).toBe(true);
      if (result.isOk()) {
        throw new Error("expected occupied port startup to fail");
      }
      expect(result.error).toMatchObject({
        _tag: "NodeServerListenError",
        hostname: "127.0.0.1",
        port,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        blocker.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  });
});
