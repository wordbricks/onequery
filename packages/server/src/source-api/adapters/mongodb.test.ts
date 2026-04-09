import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreparedSourceConnection } from "../types";
import {
  createMongoDbSourceApiAdapter,
  mongodbSourceApiAdapter,
} from "./mongodb";

const source: PreparedSourceConnection = {
  credentials: {
    connectionString: "mongodb://localhost:27017/analytics",
    database: "analytics",
    type: "mongodb",
  },
  displayName: "MongoDB Prod",
  id: "source_1",
  provider: "mongodb",
  sourceKey: "mongodb-prod",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mongodb source api adapter", () => {
  it("describes database and collection operations", async () => {
    const descriptor = await mongodbSourceApiAdapter.describe({
      actor: {
        capabilities: ["source_api.describe"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      source,
    });

    expect(descriptor.defaultPathOperation).toBeUndefined();
    expect(descriptor.operations).toMatchObject([
      {
        kind: "structured_request",
        name: "list_databases",
        selectorKind: "none",
      },
      {
        kind: "structured_request",
        name: "list_collections",
        selectorKind: "identifier",
      },
      {
        kind: "structured_request",
        name: "find_documents",
        selectorKind: "identifier",
      },
    ]);
  });

  it("normalizes selector-driven find requests into a canonical structured plan", async () => {
    const descriptor = await mongodbSourceApiAdapter.describe({
      actor: {
        capabilities: ["source_api.describe"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      source,
    });

    const plan = await mongodbSourceApiAdapter.normalize({
      actor: {
        capabilities: ["source_api.execute"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      descriptor,
      request: {
        body: {
          kind: "json",
          value: {
            filter: {
              status: "active",
            },
          },
        },
        fieldPatch: {
          limit: 25,
        },
        headers: [],
        operation: "find_documents",
        selector: "events",
      },
      source,
    });

    expect(plan).toMatchObject({
      kind: "structured_request",
      operation: "find_documents",
      provider: "mongodb",
      selector: "events",
      sourceId: "source_1",
      sourceKey: "mongodb-prod",
    });
    expect(plan.kind).toBe("structured_request");
    if (plan.kind !== "structured_request") {
      throw new Error("expected structured request plan");
    }
    expect(plan.request).toEqual({
      collection: "events",
      filter: {
        status: "active",
      },
      limit: 25,
    });
  });

  it("executes MongoDB collection requests through the shared relay", async () => {
    const listCollections = vi.fn().mockResolvedValue({
      collections: [
        {
          name: "events",
          type: "collection",
        },
      ],
      database: "analytics",
    });
    const adapter = createMongoDbSourceApiAdapter({
      findDocuments: vi.fn(),
      listCollections,
      listDatabases: vi.fn(),
    });

    const response = await adapter.execute({
      actor: {
        capabilities: ["source_api.execute"],
        membershipRoles: ["owner"],
        organizationId: "org_1",
        organizationSlug: "acme",
        userId: "user_1",
      },
      plan: {
        body: {
          kind: "none",
        },
        bodyKind: "none",
        descriptorVersion: "mongodb.v1",
        headerNames: [],
        headers: [],
        kind: "structured_request",
        operation: "list_collections",
        provider: "mongodb",
        request: {
          database: "analytics",
        },
        requestFingerprint: "fingerprint",
        selector: "analytics",
        sourceId: "source_1",
        sourceKey: "mongodb-prod",
      },
      source,
    });

    expect(listCollections).toHaveBeenCalledWith({
      credentials: source.credentials,
      request: {
        database: "analytics",
      },
    });
    expect(response).toMatchObject({
      contentType: "application/json",
      operation: "list_collections",
      selector: "analytics",
      status: 200,
    });
    expect(response.body).toEqual({
      kind: "json",
      value: {
        collections: [
          {
            name: "events",
            type: "collection",
          },
        ],
        database: "analytics",
      },
    });
  });
});
