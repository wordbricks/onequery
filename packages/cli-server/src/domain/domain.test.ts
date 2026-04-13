import { describe, expect, it } from "vitest";

import {
  CLI_PROBLEM_CATALOG,
  cliProblemCodeToString,
  cliProblemStageToString,
} from "./problems";
import { toCliAuthUserView } from "./workflows";

describe("cli domain model", () => {
  it("projects display users into CLI auth user views", () => {
    expect(
      toCliAuthUserView({
        displayName: "Alice",
        email: "alice@example.com",
        id: "user-1",
      })
    ).toEqual({
      displayName: "Alice",
      email: "alice@example.com",
      id: "user-1",
    });
  });

  it("keeps CLI problem metadata in the canonical catalog", () => {
    expect({
      ...CLI_PROBLEM_CATALOG.SOURCE_NOT_FOUND,
      code: cliProblemCodeToString(CLI_PROBLEM_CATALOG.SOURCE_NOT_FOUND.code),
      stage: cliProblemStageToString(
        CLI_PROBLEM_CATALOG.SOURCE_NOT_FOUND.stage
      ),
    }).toMatchObject({
      code: "source_not_found",
      connectCode: "not_found",
      hint: "run `onequery source list`",
      stage: "resolve_source",
      status: 404,
      title: "Source Not Found",
      type: "https://onequery.invalid/problems/cli/source-not-found",
    });
    expect({
      ...CLI_PROBLEM_CATALOG.SOURCE_API_PREPARED_REQUEST_INVALID,
      code: cliProblemCodeToString(
        CLI_PROBLEM_CATALOG.SOURCE_API_PREPARED_REQUEST_INVALID.code
      ),
      stage: cliProblemStageToString(
        CLI_PROBLEM_CATALOG.SOURCE_API_PREPARED_REQUEST_INVALID.stage
      ),
    }).toMatchObject({
      code: "source_api_prepared_request_invalid",
      connectCode: "failed_precondition",
      hint: "rerun the `onequery api` command to refresh prepared source API state",
      stage: "execute_query",
      status: 410,
      title: "Prepared Source API Request Invalid",
      type: "https://onequery.invalid/problems/cli/source-api-prepared-request-invalid",
    });
    expect(CLI_PROBLEM_CATALOG.AUTH_REQUEST_INVALID.stage).toBeDefined();
    expect(CLI_PROBLEM_CATALOG.SOURCE_REQUEST_INVALID.stage).toBeDefined();
    expect(CLI_PROBLEM_CATALOG.READ_QUERY_INPUT_INVALID.stage).toBeDefined();
    expect(
      CLI_PROBLEM_CATALOG.EXECUTE_QUERY_REQUEST_INVALID.stage
    ).toBeDefined();
  });
});
