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
    ).toMatchSnapshot();
  });

  it("keeps CLI problem metadata in the canonical catalog", () => {
    expect({
      notLoggedIn: {
        ...CLI_PROBLEM_CATALOG.NOT_LOGGED_IN,
        code: cliProblemCodeToString(CLI_PROBLEM_CATALOG.NOT_LOGGED_IN.code),
        stage: cliProblemStageToString(CLI_PROBLEM_CATALOG.NOT_LOGGED_IN.stage),
      },
      sourceApiExecutionStateInvalid: {
        ...CLI_PROBLEM_CATALOG.SOURCE_API_EXECUTION_STATE_INVALID,
        code: cliProblemCodeToString(
          CLI_PROBLEM_CATALOG.SOURCE_API_EXECUTION_STATE_INVALID.code
        ),
        stage: cliProblemStageToString(
          CLI_PROBLEM_CATALOG.SOURCE_API_EXECUTION_STATE_INVALID.stage
        ),
      },
      sourceNotFound: {
        ...CLI_PROBLEM_CATALOG.SOURCE_NOT_FOUND,
        code: cliProblemCodeToString(CLI_PROBLEM_CATALOG.SOURCE_NOT_FOUND.code),
        stage: cliProblemStageToString(
          CLI_PROBLEM_CATALOG.SOURCE_NOT_FOUND.stage
        ),
      },
    }).toMatchSnapshot();
    expect(CLI_PROBLEM_CATALOG.AUTH_REQUEST_INVALID.stage).toBeDefined();
    expect(CLI_PROBLEM_CATALOG.SOURCE_REQUEST_INVALID.stage).toBeDefined();
    expect(CLI_PROBLEM_CATALOG.READ_QUERY_INPUT_INVALID.stage).toBeDefined();
    expect(
      CLI_PROBLEM_CATALOG.EXECUTE_QUERY_REQUEST_INVALID.stage
    ).toBeDefined();
  });
});
