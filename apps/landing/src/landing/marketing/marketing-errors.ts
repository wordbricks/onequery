import type { LandingProblemResponse } from "../../app/runtime/landing-api-client";

type LandingValidationProblemResponse = Extract<
  LandingProblemResponse,
  { status: 422 }
>;

function readFirstFieldErrorMessage(
  errors: LandingValidationProblemResponse["errors"]
): string | null {
  const firstError = errors[0];
  return firstError?.message ?? null;
}

export function readApiErrorMessage(
  response: LandingProblemResponse,
  fallback: string
): string {
  if (response.status === 422) {
    const fieldErrorMessage = readFirstFieldErrorMessage(response.errors);
    if (fieldErrorMessage) {
      return fieldErrorMessage;
    }
  }

  if (response.detail && response.detail.length > 0) {
    return response.detail;
  }

  if (response.title.length > 0) {
    return response.title;
  }

  return fallback;
}
