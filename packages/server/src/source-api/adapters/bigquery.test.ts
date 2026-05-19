import { afterEach, describe, expect, it, vi } from "vitest";

import { finalizePreparedSourceApi } from "../normalize";
import type { PreparedSourceConnection } from "../types";
import { bigQuerySourceApiAdapter } from "./bigquery";

const originalFetch = globalThis.fetch;

const source: PreparedSourceConnection = {
  credentials: {
    accessToken: "ya29.bigquery-token",
    authType: "oauth",
    expiresAt: 1_900_000_000,
    projectId: "project-123",
    refreshToken: "refresh-token",
    type: "bigquery",
  },
  displayName: "BigQuery Prod",
  id: "source_1",
  provider: "bigquery",
  sourceKey: "bq-prod",
};

const actor = {
  capabilities: ["source_api.describe", "source_api.execute"],
  membershipRoles: ["owner"],
  organizationId: "org_1",
  organizationSlug: "acme",
  userId: "user_1",
} as const;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("bigquery source api adapter", () => {
  it("describes the datasets.list operation", async () => {
    const descriptor = await bigQuerySourceApiAdapter.describe({
      actor,
      source,
    });

    expect(descriptor).toMatchObject({
      descriptorVersion: "bigquery.v1",
      operations: [
        {
          kind: "structured_request",
          methodPolicy: {
            allowedMethods: ["GET"],
            defaultMethod: "GET",
          },
          name: "datasets.list",
          selectorKind: "none",
        },
      ],
      source: {
        provider: "bigquery",
        sourceKey: "bq-prod",
      },
    });
    expect(descriptor.examples[0]?.command).toBe(
      'onequery api --source bq-prod --op datasets.list --input \'{"all":true,"maxResults":1000}\''
    );
  });

  it("normalizes datasets.list request parameters", async () => {
    const descriptor = await bigQuerySourceApiAdapter.describe({
      actor,
      source,
    });

    const plan = await bigQuerySourceApiAdapter.normalize({
      actor,
      descriptor,
      request: {
        body: {
          kind: "json",
          value: {
            all: true,
            maxResults: 50,
          },
        },
        fieldPatch: {
          pageToken: "page-2",
        },
        headers: [],
        operation: "datasets.list",
      },
      source,
    });

    expect(finalizePreparedSourceApi(plan)).toMatchObject({
      kind: "structured_request",
      method: "GET",
      operation: "datasets.list",
      provider: "bigquery",
      request: {
        all: true,
        maxResults: 50,
        pageToken: "page-2",
      },
      selectorTemplate: "projects/{projectId}/datasets",
    });
  });

  it("executes BigQuery datasets.list with the connected OAuth credential", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        datasets: [
          {
            datasetReference: {
              datasetId: "analytics",
              projectId: "project-123",
            },
            id: "project-123:analytics",
          },
        ],
        nextPageToken: "next-page",
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await bigQuerySourceApiAdapter.execute({
      actor,
      prepared: {
        body: {
          kind: "json",
          value: {
            all: true,
            maxResults: 50,
          },
        },
        bodyKind: "json",
        bodyPaths: [],
        descriptorVersion: "bigquery.v1",
        headerNames: [],
        headers: [],
        kind: "structured_request",
        method: "GET",
        operation: "datasets.list",
        paginationPolicy: "none",
        preparedBinding: "binding",
        provider: "bigquery",
        request: {
          all: true,
          maxResults: 50,
        },
        selectorTemplate: "projects/{projectId}/datasets",
        sourceId: "source_1",
        sourceKey: "bq-prod",
      },
      source,
    });

    expect(response).toEqual({
      body: {
        kind: "json",
        value: {
          datasets: [
            {
              datasetReference: {
                datasetId: "analytics",
                projectId: "project-123",
              },
              id: "project-123:analytics",
            },
          ],
          nextPageToken: "next-page",
        },
      },
      contentType: "application/json",
      headers: [{ name: "content-type", value: "application/json" }],
      operation: "datasets.list",
      source: {
        displayName: "BigQuery Prod",
        provider: "bigquery",
        sourceKey: "bq-prod",
      },
      status: 200,
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(calledUrl));
    expect(url.origin).toBe("https://bigquery.googleapis.com");
    expect(url.pathname).toBe("/bigquery/v2/projects/project-123/datasets");
    expect(url.searchParams.get("all")).toBe("true");
    expect(url.searchParams.get("maxResults")).toBe("50");
    expect(calledInit).toMatchObject({
      method: "GET",
    });
    const headers = calledInit?.headers;
    expect(headers).toBeInstanceOf(Headers);
    expect((headers as Headers).get("Authorization")).toBe(
      "Bearer ya29.bigquery-token"
    );
  });
});
