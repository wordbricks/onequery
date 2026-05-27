import { describe, expect, it } from "vitest";

import { buildCliDescribeSourceApiResponse } from "./codec";

describe("source api codec", () => {
  it("formats descriptor and operation examples with source URI references", () => {
    const response = buildCliDescribeSourceApiResponse({
      defaultPathOperation: "http_request",
      descriptorVersion: "github.v1",
      examples: [
        {
          command: "onequery api --source github-prod /user",
          label: "Current user",
        },
      ],
      notes: [],
      operations: [
        {
          description: "Fetch one GitHub API path.",
          examples: [
            {
              command: "onequery api --source github-prod /repos/acme/app",
              label: "Repository",
            },
          ],
          fieldPolicy: {
            acceptsInput: false,
            allowsRawFields: false,
            allowsTypedFields: false,
            inputMode: "none",
            mergePatches: false,
            supportsArrayPaths: false,
            supportsNestedPaths: false,
          },
          headerPolicy: {
            allowedRequestHeaders: [],
            allowedResponseHeaders: [],
          },
          kind: "http_request",
          methodPolicy: {
            allowedMethods: ["GET"],
            defaultMethod: "GET",
          },
          name: "http_request",
          notes: [],
          paginationPolicy: "none",
          selectorKind: "path",
          summary: "Fetch a path.",
        },
      ],
      source: {
        provider: "github",
        sourceKey: "github-prod",
      },
    });

    expect(response.examples).toEqual([
      expect.objectContaining({
        command: "onequery api --source github://github-prod /user",
      }),
    ]);
    expect(response.operations).toEqual([
      expect.objectContaining({
        examples: [
          expect.objectContaining({
            command:
              "onequery api --source github://github-prod /repos/acme/app",
          }),
        ],
      }),
    ]);
  });
});
