import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { CliOrgCapability } from "../gen/onequery/cli/v1/org_pb";
import {
  ExecutePreparedSourceApiResponseSchema,
  SourceApiDraftSchema,
} from "../gen/onequery/cli/v1/source_api_pb";
import {
  fromCliSourceApiDraft,
  toCliExecutePreparedSourceApiResponse,
  toCliOrgCapability,
} from "./conversions";

describe("toCliOrgCapability", () => {
  it("maps source API actions to first-class org capabilities", () => {
    expect(toCliOrgCapability("source_api.describe")).toBe(
      CliOrgCapability.SOURCE_API_DESCRIBE
    );
    expect(toCliOrgCapability("source_api.execute")).toBe(
      CliOrgCapability.SOURCE_API_EXECUTE
    );
  });
});

describe("source api WKT conversions", () => {
  it("round-trips request draft Value and Struct payloads into domain JSON once", () => {
    const draft = create(SourceApiDraftSchema, {
      body: {
        case: "jsonBody",
        value: fromJson(ValueSchema, {
          filter: {
            state: "open",
          },
          limit: 25,
        }),
      },
      fieldPatch: {
        params: {
          perPage: 50,
        },
      },
      headers: [
        {
          name: "accept",
          value: "application/json",
        },
      ],
      methodOverride: "POST",
      operation: "fetch",
      selector: "/issues",
    });

    expect(fromCliSourceApiDraft(draft)).toMatchSnapshot();
  });

  it("round-trips response JSON bodies through generated protobuf Value messages", () => {
    const response = create(
      ExecutePreparedSourceApiResponseSchema,
      toCliExecutePreparedSourceApiResponse({
        body: {
          kind: "json",
          value: {
            id: 1,
            labels: ["bug", "feature"],
            private: false,
          },
        },
        contentType: "application/json",
        headers: [],
        nextPageToken: "page_2",
        operation: "fetch",
        selector: "/issues",
        source: {
          displayName: "GitHub Prod",
          key: "github-prod",
          provider: "github",
        },
        status: 200,
      })
    );

    const responseBody = response.body;
    expect(responseBody.case).toBe("json");
    if (responseBody.case !== "json") {
      throw new Error("expected JSON response body");
    }

    expect({
      bodyCase: responseBody.case,
      contentType: response.contentType,
      jsonBody: toJson(ValueSchema, create(ValueSchema, responseBody.value)),
      nextPageToken: response.nextPageToken,
      operation: response.operation,
      requestId: (response as Record<string, unknown>).requestId,
      selector: response.selector,
      source: response.source,
      status: response.status,
    }).toMatchSnapshot();
  });
});
