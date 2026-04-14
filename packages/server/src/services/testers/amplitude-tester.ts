import type { AmplitudeCredentials } from "@onequery/db/server";
import { Result } from "better-result";

import { fetchAmplitudeApi } from "../amplitude/relay";
import { createHttpTester } from "./create-http-tester";
import { parseHttpStatusError } from "./parse-http-error";

export const testAmplitudeConnection = createHttpTester<AmplitudeCredentials>({
  parseError: (error, latencyMs, timeoutSeconds) =>
    Result.err(
      parseHttpStatusError(error, latencyMs, timeoutSeconds, {
        accessDeniedError: "API Key does not have required permissions",
        authenticationError: "Invalid API Key or Secret Key",
      })
    ),
  probe: (credentials, timeoutMs) =>
    fetchAmplitudeApi({
      credentials,
      endpoint: "/api/2/taxonomy/event",
      options: {
        method: "GET",
        timeoutMs,
      },
    }),
});
