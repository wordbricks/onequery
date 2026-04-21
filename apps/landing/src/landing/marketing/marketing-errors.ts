import type {
  LandingInternalProblemResponse,
  LandingServiceUnavailableProblemResponse,
  LandingValidationProblemResponse,
} from "../../server/landing/landing-app";

export type LandingApiProblemResponse =
  | LandingInternalProblemResponse
  | LandingServiceUnavailableProblemResponse
  | LandingValidationProblemResponse;

function readFirstFieldErrorMessage(
  errors: LandingValidationProblemResponse["errors"]
): string | null {
  const firstError = errors[0];
  return firstError?.message ?? null;
}

export function readApiErrorMessage(
  response: LandingApiProblemResponse,
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
