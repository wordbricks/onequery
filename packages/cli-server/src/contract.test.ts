import { cliOpenApiDocument } from "@onequery/cli-contract";
import { describe, expect, it } from "vitest";

import {
  CLI_PROBLEM_CATALOG,
  CLI_PROBLEM_TYPE_PREFIX,
} from "./domain/problems";
import {
  CLI_ORG_SLUG_PATTERN,
  CLI_SAFE_PATH_SEGMENT_PATTERN,
} from "./identifiers";
import { getCliOpenApiDocument } from "./route";

function parameterByName<T>(parameters: readonly T[], name: string) {
  return parameters.find(
    (parameter) =>
      typeof parameter === "object" &&
      parameter !== null &&
      "name" in parameter &&
      parameter.name === name
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function jsonContentNode(value: unknown) {
  if (!isRecord(value)) {
    return;
  }

  const { content } = value;
  if (!isRecord(content)) {
    return;
  }

  const applicationJson = content["application/json"];
  return isRecord(applicationJson) ? applicationJson : undefined;
}

function hasJsonExample(value: unknown) {
  const applicationJson = jsonContentNode(value);
  if (!applicationJson) {
    return false;
  }

  if ("example" in applicationJson && applicationJson.example !== undefined) {
    return true;
  }

  if (!("examples" in applicationJson) || !isRecord(applicationJson.examples)) {
    return false;
  }

  return Object.keys(applicationJson.examples).length > 0;
}

function jsonExample(value: unknown) {
  const applicationJson = jsonContentNode(value);
  if (!applicationJson) {
    return;
  }

  if ("example" in applicationJson && applicationJson.example !== undefined) {
    return applicationJson.example;
  }

  if (!("examples" in applicationJson) || !isRecord(applicationJson.examples)) {
    return;
  }

  const firstExample = Object.values(applicationJson.examples)[0];
  if (!isRecord(firstExample) || !("value" in firstExample)) {
    return;
  }

  return firstExample.value;
}

function responseByStatus(operation: unknown, status: string) {
  if (!isRecord(operation) || !isRecord(operation.responses)) {
    return;
  }

  return operation.responses[status];
}

function unknownValue(value: unknown) {
  return value;
}

describe("cli contract invariants", () => {
  it("keeps canonical problem types unique and prefixed", () => {
    const problemTypes = Object.values(CLI_PROBLEM_CATALOG).map(
      (problem) => problem.type
    );

    expect(new Set(problemTypes).size).toBe(problemTypes.length);
    expect(
      problemTypes.every((problemType) =>
        problemType.startsWith(`${CLI_PROBLEM_TYPE_PREFIX}/`)
      )
    ).toBe(true);
  });

  it("serves the checked-in canonical openapi artifact", async () => {
    const generatedDocument = getCliOpenApiDocument();

    expect(generatedDocument).toEqual(cliOpenApiDocument);
  });

  it("exposes x-onequery route metadata for every current public operation", () => {
    const generatedDocument = getCliOpenApiDocument();
    const paths = generatedDocument.paths ?? {};
    const expectedOperations = [
      paths["/openapi.json"]?.get,
      paths["/use"]?.get,
      paths["/session"]?.get,
      paths["/session:refresh"]?.post,
      paths["/auth/device-authorizations"]?.post,
      paths["/auth/device-authorizations:poll"]?.post,
      paths["/organizations"]?.get,
      paths["/organizations/{orgSlug}"]?.get,
      paths["/organizations/{orgSlug}/sources"]?.get,
      paths["/organizations/{orgSlug}/sources:connect"]?.get,
      paths["/organizations/{orgSlug}/sources:connect"]?.post,
      paths["/organizations/{orgSlug}/sources/{sourceKey}"]?.get,
      paths["/organizations/{orgSlug}/sources/{sourceKey}/queries:validate"]
        ?.post,
      paths["/organizations/{orgSlug}/sources/{sourceKey}/queries:execute"]
        ?.post,
    ];

    for (const operation of expectedOperations) {
      expect(operation).toMatchObject({
        "x-onequery-auth-requirements": {
          authenticated: expect.any(Boolean),
          modes: expect.any(Array),
          orgScoped: expect.any(Boolean),
        },
        "x-onequery-command": expect.any(String),
        "x-onequery-expose-command-schema": expect.any(Boolean),
        "x-onequery-kind": expect.any(String),
        "x-onequery-read-controls": expect.any(Object),
        "x-onequery-retryable-statuses": expect.any(Array),
        "x-onequery-stable-error-codes": expect.any(Array),
        "x-onequery-supports-dry-run": expect.any(Boolean),
        "x-onequery-supports-fields": expect.any(Boolean),
        "x-onequery-supports-pagination": expect.any(Boolean),
        "x-onequery-supports-raw-input": expect.any(Boolean),
        "x-onequery-untrusted-response-paths": expect.any(Array),
      });

      expect(isRecord(operation)).toBe(true);
      if (!isRecord(operation)) {
        continue;
      }

      const untrustedResponsePaths =
        operation["x-onequery-untrusted-response-paths"];
      expect(Array.isArray(untrustedResponsePaths)).toBe(true);
      expect(operation["x-onequery-sanitization-profile"]).toBe(
        Array.isArray(untrustedResponsePaths) &&
          untrustedResponsePaths.length > 0
          ? "default-v1"
          : null
      );

      const readControls = operation["x-onequery-read-controls"];
      expect(isRecord(readControls)).toBe(true);

      if (!isRecord(readControls)) {
        continue;
      }

      expect(Object.keys(readControls).toSorted()).toEqual([
        "cursor",
        "fields",
        "limit",
        "sort",
      ]);

      for (const controlName of [
        "fields",
        "limit",
        "cursor",
        "sort",
      ] as const) {
        const control = readControls[controlName];

        expect(isRecord(control)).toBe(true);
        if (!isRecord(control)) {
          continue;
        }

        expect(control.support).toMatch(/^(supported|unsupported)$/);
        expect(control).toHaveProperty("unsupportedReason");
      }

      expect(operation["x-onequery-supports-fields"]).toBe(
        isRecord(readControls.fields) &&
          readControls.fields.support === "supported"
      );
      expect(operation["x-onequery-supports-pagination"]).toBe(
        (isRecord(readControls.limit) &&
          readControls.limit.support === "supported") ||
          (isRecord(readControls.cursor) &&
            readControls.cursor.support === "supported")
      );
      expect(readControls.sort).toEqual({
        support: "unsupported",
        unsupportedReason: "not_sortable",
      });
    }

    expect(paths["/openapi.json"]?.get).toMatchObject({
      "x-onequery-auth-requirements": {
        authenticated: false,
        modes: ["none"],
        orgScoped: false,
      },
      "x-onequery-command": "schema openapi",
      "x-onequery-expose-command-schema": false,
      "x-onequery-kind": "discovery",
      "x-onequery-required-org-role": null,
    });

    expect(paths["/use"]?.get).toMatchObject({
      "x-onequery-auth-requirements": {
        authenticated: false,
        modes: ["none"],
        orgScoped: false,
      },
      "x-onequery-command": "use",
      "x-onequery-expose-command-schema": true,
      "x-onequery-kind": "discovery",
      "x-onequery-required-org-role": null,
    });

    expect(paths["/auth/device-authorizations"]?.post).toMatchObject({
      "x-onequery-command": "auth login start",
      "x-onequery-expose-command-schema": false,
      "x-onequery-required-org-role": null,
    });

    expect(paths["/auth/device-authorizations:poll"]?.post).toMatchObject({
      "x-onequery-command": "auth login poll",
      "x-onequery-expose-command-schema": false,
    });

    expect(
      paths["/organizations/{orgSlug}/sources/{sourceKey}/queries:execute"]
        ?.post
    ).toMatchObject({
      "x-onequery-auth-requirements": {
        authenticated: true,
        modes: ["session_cookie", "bearer_token"],
        orgScoped: true,
      },
      "x-onequery-command": "query execute",
      "x-onequery-expose-command-schema": true,
      "x-onequery-kind": "read",
      "x-onequery-read-controls": {
        fields: {
          support: "supported",
          unsupportedReason: null,
        },
        limit: {
          support: "supported",
          unsupportedReason: null,
        },
        cursor: {
          support: "supported",
          unsupportedReason: null,
        },
        sort: {
          support: "unsupported",
          unsupportedReason: "not_sortable",
        },
      },
      "x-onequery-required-org-role": "member",
      "x-onequery-retryable-statuses": [503, 504],
      "x-onequery-sanitization-profile": "default-v1",
      "x-onequery-stable-error-codes": [
        "not_logged_in",
        "forbidden",
        "org_not_found",
        "source_not_found",
        "source_not_queryable",
        "query_rejected",
        "query_preparation_failed",
        "query_execution_failed",
        "query_execution_unavailable",
        "query_execution_timed_out",
        "invalid_request",
      ],
      "x-onequery-supports-raw-input": true,
      "x-onequery-untrusted-response-paths": [
        "$.data.columns[*].name",
        "$.data.rows[*][*]",
      ],
    });

    expect(
      paths["/organizations/{orgSlug}/sources/{sourceKey}/queries:validate"]
        ?.post
    ).toMatchObject({
      "x-onequery-command": "query validate",
      "x-onequery-expose-command-schema": true,
      "x-onequery-kind": "read",
      "x-onequery-required-org-role": "member",
      "x-onequery-stable-error-codes": [
        "not_logged_in",
        "forbidden",
        "org_not_found",
        "source_not_found",
        "source_not_queryable",
        "query_rejected",
        "invalid_request",
      ],
      "x-onequery-supports-raw-input": true,
    });

    expect(paths["/organizations/{orgSlug}"]?.get).toMatchObject({
      "x-onequery-auth-requirements": {
        authenticated: true,
        modes: ["session_cookie", "bearer_token"],
        orgScoped: true,
      },
      "x-onequery-command": "org get",
      "x-onequery-expose-command-schema": true,
      "x-onequery-kind": "read",
      "x-onequery-read-controls": {
        fields: {
          support: "supported",
          unsupportedReason: null,
        },
        limit: {
          support: "unsupported",
          unsupportedReason: "not_paginated",
        },
        cursor: {
          support: "unsupported",
          unsupportedReason: "not_paginated",
        },
        sort: {
          support: "unsupported",
          unsupportedReason: "not_sortable",
        },
      },
      "x-onequery-required-org-role": "member",
      "x-onequery-stable-error-codes": [
        "not_logged_in",
        "forbidden",
        "org_not_found",
        "invalid_request",
      ],
      "x-onequery-supports-fields": true,
    });

    expect(
      paths["/organizations/{orgSlug}/sources:connect"]?.get
    ).toMatchObject({
      "x-onequery-auth-requirements": {
        authenticated: true,
        modes: ["session_cookie", "bearer_token"],
        orgScoped: true,
      },
      "x-onequery-command": "source connect guide",
      "x-onequery-expose-command-schema": false,
      "x-onequery-kind": "discovery",
      "x-onequery-required-org-role": "member",
      "x-onequery-stable-error-codes": [
        "not_logged_in",
        "forbidden",
        "org_not_found",
        "invalid_request",
      ],
      "x-onequery-supports-raw-input": false,
    });

    expect(
      paths["/organizations/{orgSlug}/sources:connect"]?.post
    ).toMatchObject({
      "x-onequery-auth-requirements": {
        authenticated: true,
        modes: ["session_cookie", "bearer_token"],
        orgScoped: true,
      },
      "x-onequery-command": "source connect",
      "x-onequery-expose-command-schema": true,
      "x-onequery-kind": "mutate",
      "x-onequery-required-org-role": "member",
      "x-onequery-stable-error-codes": [
        "not_logged_in",
        "forbidden",
        "org_not_found",
        "invalid_request",
        "source_name_conflict",
      ],
      "x-onequery-supports-raw-input": true,
    });
  });

  it("publishes hardened identifier schemas for path selectors", () => {
    const generatedDocument = getCliOpenApiDocument();
    const paths = generatedDocument.paths ?? {};
    const orgGetParameters =
      paths["/organizations/{orgSlug}"]?.get?.parameters ?? [];
    const sourceShowParameters =
      paths["/organizations/{orgSlug}/sources/{sourceKey}"]?.get?.parameters ??
      [];

    expect(parameterByName(orgGetParameters, "orgSlug")).toMatchObject({
      schema: {
        minLength: 1,
        pattern: CLI_ORG_SLUG_PATTERN.source,
      },
    });
    expect(parameterByName(sourceShowParameters, "sourceKey")).toMatchObject({
      schema: {
        minLength: 1,
        pattern: CLI_SAFE_PATH_SEGMENT_PATTERN.source,
      },
    });
  });

  it("keeps concrete success and failure examples on public CLI operations", () => {
    const generatedDocument = getCliOpenApiDocument();
    const paths = generatedDocument.paths ?? {};
    const expectedOperations = [
      {
        failureStatuses: [],
        label: "GET /openapi.json",
        operation: unknownValue(paths["/openapi.json"]?.get),
        requiresRequestExample: false,
      },
      {
        failureStatuses: ["422"],
        label: "GET /use",
        operation: unknownValue(paths["/use"]?.get),
        requiresRequestExample: false,
      },
      {
        failureStatuses: ["401"],
        label: "GET /session",
        operation: unknownValue(paths["/session"]?.get),
        requiresRequestExample: false,
      },
      {
        failureStatuses: ["401"],
        label: "POST /session:refresh",
        operation: unknownValue(paths["/session:refresh"]?.post),
        requiresRequestExample: false,
      },
      {
        failureStatuses: ["400", "429"],
        label: "POST /auth/device-authorizations",
        operation: unknownValue(paths["/auth/device-authorizations"]?.post),
        requiresRequestExample: false,
      },
      {
        failureStatuses: ["400", "403", "410", "429"],
        label: "POST /auth/device-authorizations:poll",
        operation: unknownValue(
          paths["/auth/device-authorizations:poll"]?.post
        ),
        requiresRequestExample: true,
      },
      {
        failureStatuses: ["401"],
        label: "GET /organizations",
        operation: unknownValue(paths["/organizations"]?.get),
        requiresRequestExample: false,
      },
      {
        failureStatuses: ["401", "403", "404", "422"],
        label: "GET /organizations/{orgSlug}",
        operation: unknownValue(paths["/organizations/{orgSlug}"]?.get),
        requiresRequestExample: false,
      },
      {
        failureStatuses: ["401", "403", "404", "422"],
        label: "GET /organizations/{orgSlug}/sources",
        operation: unknownValue(paths["/organizations/{orgSlug}/sources"]?.get),
        requiresRequestExample: false,
      },
      {
        failureStatuses: ["401", "403", "404", "422"],
        label: "GET /organizations/{orgSlug}/sources/{sourceKey}",
        operation: unknownValue(
          paths["/organizations/{orgSlug}/sources/{sourceKey}"]?.get
        ),
        requiresRequestExample: false,
      },
      {
        failureStatuses: ["400", "401", "403", "404", "422"],
        label:
          "POST /organizations/{orgSlug}/sources/{sourceKey}/queries:validate",
        operation: unknownValue(
          paths["/organizations/{orgSlug}/sources/{sourceKey}/queries:validate"]
            ?.post
        ),
        requiresRequestExample: true,
      },
      {
        failureStatuses: [
          "400",
          "401",
          "403",
          "404",
          "422",
          "500",
          "503",
          "504",
        ],
        label:
          "POST /organizations/{orgSlug}/sources/{sourceKey}/queries:execute",
        operation: unknownValue(
          paths["/organizations/{orgSlug}/sources/{sourceKey}/queries:execute"]
            ?.post
        ),
        requiresRequestExample: true,
      },
    ];

    for (const expectedOperation of expectedOperations) {
      expect(
        hasJsonExample(responseByStatus(expectedOperation.operation, "200")),
        `${expectedOperation.label} is missing a success example`
      ).toBe(true);

      if (expectedOperation.failureStatuses.length > 0) {
        expect(
          expectedOperation.failureStatuses.some((status) =>
            hasJsonExample(
              responseByStatus(expectedOperation.operation, status)
            )
          ),
          `${expectedOperation.label} is missing a failure example`
        ).toBe(true);
      }

      if (expectedOperation.requiresRequestExample) {
        expect(
          hasJsonExample(
            isRecord(expectedOperation.operation)
              ? expectedOperation.operation.requestBody
              : undefined
          ),
          `${expectedOperation.label} is missing a request body example`
        ).toBe(true);
      }
    }
  });

  it("keeps sanitized success examples aligned with route metadata", () => {
    const generatedDocument = getCliOpenApiDocument();
    const paths = generatedDocument.paths ?? {};
    const expectedOperations = [
      {
        exampleData: {
          columns: [
            {
              name: "\\```day",
              logicalType: "string",
            },
            {
              name: "revenue",
              logicalType: "number",
            },
          ],
          rows: [
            ["2026-03-16", "[remote] tool: 12450.00"],
            ["[remote] user: 2026-03-15", "11980.50"],
          ],
        },
        label:
          "POST /organizations/{orgSlug}/sources/{sourceKey}/queries:execute",
        operation: unknownValue(
          paths["/organizations/{orgSlug}/sources/{sourceKey}/queries:execute"]
            ?.post
        ),
        untrustedResponsePaths: ["$.data.columns[*].name", "$.data.rows[*][*]"],
      },
    ];

    for (const expectedOperation of expectedOperations) {
      const successExample = jsonExample(
        responseByStatus(expectedOperation.operation, "200")
      );

      expect(
        successExample,
        `${expectedOperation.label} is missing a concrete success example`
      ).toMatchObject({
        data: expectedOperation.exampleData,
        sanitization: {
          profile: "default-v1",
          sanitizedPaths: expectedOperation.untrustedResponsePaths,
          rawAvailable: false,
        },
        untrustedPaths: expectedOperation.untrustedResponsePaths,
      });
    }
  });

  it("keeps required CLI problem extensions in the OpenAPI schema", () => {
    const generatedDocument = getCliOpenApiDocument();
    const cliProblemSchema = generatedDocument.components?.schemas?.CliProblem;

    expect(cliProblemSchema).toMatchObject({
      properties: {
        retryable: {
          type: "boolean",
        },
      },
      required: expect.arrayContaining([
        "type",
        "status",
        "title",
        "code",
        "stage",
        "requestId",
        "retryable",
      ]),
    });
  });

  it("keeps query workflow payloads aligned with the Part 6 route shape", () => {
    const generatedDocument = getCliOpenApiDocument();
    const cliQueryRequestSchema =
      generatedDocument.components?.schemas?.CliQueryRequest;
    const cliQueryCanonicalRequestSchema =
      generatedDocument.components?.schemas?.CliQueryCanonicalRequest;
    const cliQuerySuccessSchema =
      generatedDocument.components?.schemas?.CliQuerySuccess;
    const cliSourceSummarySchema =
      generatedDocument.components?.schemas?.CliSourceSummary;

    expect(cliQueryRequestSchema).toMatchObject({
      properties: {
        parameters: {
          items: {
            $ref: "#/components/schemas/CliQueryParameter",
          },
          type: "array",
        },
      },
    });
    expect(cliQueryCanonicalRequestSchema).toMatchObject({
      properties: {
        parameters: {
          items: {
            $ref: "#/components/schemas/CliQueryParameter",
          },
          type: "array",
        },
      },
    });
    expect(cliQuerySuccessSchema).toMatchObject({
      properties: {
        source: {
          $ref: "#/components/schemas/CliSourceSummary",
        },
      },
    });
    expect(cliQuerySuccessSchema).not.toMatchObject({
      properties: {
        provider: expect.anything(),
      },
    });
    expect(cliSourceSummarySchema).toMatchObject({
      properties: {
        provider: {
          $ref: "#/components/schemas/CliSourceProvider",
        },
      },
    });
  });

  it("keeps standard org capability metadata aligned with OSS-safe actions", () => {
    const generatedDocument = getCliOpenApiDocument();
    const cliOrgCapabilitySchema =
      generatedDocument.components?.schemas?.CliOrgCapability;

    expect(cliOrgCapabilitySchema).toMatchObject({
      enum: [
        "org.list",
        "org.read",
        "source.connect",
        "source.list",
        "source.read",
        "query.execute",
      ],
    });
  });
});
