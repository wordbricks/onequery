import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createProviderQuerySchema,
  parseProviderRequest,
} from "./query-validation";

describe("data source query validation helpers", () => {
  it("builds the shared provider query envelope from the organization locator", () => {
    const schema = createProviderQuerySchema(z.enum(["fetch_api"]));

    expect(
      schema.parse({
        method: "fetch_api",
        organizationId: "org_123",
        request: {
          endpoint: "/projects",
        },
      })
    ).toMatchObject({
      method: "fetch_api",
      organizationId: "org_123",
    });

    expect(
      schema.parse({
        method: "fetch_api",
        organizationSlug: "onequery",
        request: {
          endpoint: "/projects",
        },
      })
    ).toMatchObject({
      method: "fetch_api",
      organizationSlug: "onequery",
    });
  });

  it("returns a caller-provided validation error for invalid nested payloads", () => {
    const parsed = parseProviderRequest(
      z.object({
        endpoint: z.string().min(1),
      }),
      {
        endpoint: "",
      },
      "Invalid provider request payload"
    );

    expect(parsed).toEqual({
      error: "Invalid provider request payload",
      ok: false,
    });
  });

  it("returns parsed data for valid nested payloads", () => {
    const parsed = parseProviderRequest(
      z.object({
        endpoint: z.string().min(1),
      }),
      {
        endpoint: "/events",
      },
      "Invalid provider request payload"
    );

    expect(parsed).toEqual({
      data: {
        endpoint: "/events",
      },
      ok: true,
    });
  });
});
