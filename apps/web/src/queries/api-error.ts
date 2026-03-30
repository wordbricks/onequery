import { isRecord } from "@onequery/base";

type ApiErrorPayload = {
  code?: string;
  message: string;
};

type ApiError = Error & { code?: string };

const getStringProperty = (
  value: Record<string, unknown>,
  key: string
): string | null => {
  const property = value[key];
  if (typeof property !== "string") {
    return null;
  }

  return property;
};

export const parseApiErrorPayload = (
  error: unknown
): ApiErrorPayload | null => {
  if (!isRecord(error)) {
    return null;
  }

  const errorValue = error.error;
  if (typeof errorValue === "string") {
    return { message: errorValue };
  }

  if (!isRecord(errorValue)) {
    return null;
  }

  const message = getStringProperty(errorValue, "message");
  if (!message) {
    return null;
  }

  const code = getStringProperty(errorValue, "code");
  if (!code) {
    return { message };
  }

  return { code, message };
};

export const createApiError = (payload: ApiErrorPayload): ApiError => {
  const error = new Error(payload.message);
  if (!payload.code) {
    return error;
  }

  return Object.assign(error, { code: payload.code });
};

export const isApiErrorWithCode = (error: unknown, code: string): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const errorRecord = isRecord(error) ? error : null;
  const rawCode = errorRecord ? errorRecord.code : null;
  const apiCode = typeof rawCode === "string" ? rawCode : null;

  if (!apiCode) {
    return false;
  }

  return apiCode === code;
};

export function getApiErrorMessage(error: unknown, fallback: string): string {
  const payload = parseApiErrorPayload(error);
  if (payload) {
    return payload.message;
  }

  return fallback;
}
