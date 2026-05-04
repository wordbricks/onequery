import { Hono } from "hono";
import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";

import type { StorageVariables } from "../storage";
import { betterAuthSessionMiddleware } from "./better-auth-session";
import type { BetterAuthSessionVariables } from "./better-auth-session";

function createMockStorage(input: {
  getSession: (request: { headers: Headers }) => Promise<unknown>;
}): StorageVariables["storage"] {
  return {
    auth: {
      api: {
        getSession: input.getSession,
      },
    },
  } as unknown as StorageVariables["storage"];
}

describe("better auth session middleware", () => {
  it("falls back to an anonymous session when auth session lookup throws", async () => {
    const app = new Hono<{
      Variables: BetterAuthSessionVariables;
    }>()
      .use("*", async (c, next) => {
        (
          c as typeof c & {
            set: (key: "storage", value: StorageVariables["storage"]) => void;
          }
        ).set(
          "storage",
          createMockStorage({
            getSession: async () => {
              throw new Error("session backend unavailable");
            },
          })
        );
        await next();
      })
      .use("*", betterAuthSessionMiddleware())
      .get("/", (c) => c.json({ session: c.get("session") }));

    const response = await testClient(app).index.$get();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      session: null,
    });
  });
});
