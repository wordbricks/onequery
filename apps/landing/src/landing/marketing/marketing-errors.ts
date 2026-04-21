import type { LandingProblemResponse } from "../../app/runtime/landing-api-client";

export function readApiErrorMessage(
  response: LandingProblemResponse,
  fallback: string
): string {
  if (response.body.message.length > 0) {
    return response.body.message;
  }

  return fallback;
}
