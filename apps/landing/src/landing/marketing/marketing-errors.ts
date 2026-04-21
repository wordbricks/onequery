type JsonReadableResponse = {
  clone: () => {
    json: () => Promise<unknown>;
  };
};

type ProblemDetailsBody = {
  detail?: unknown;
  title?: unknown;
  errors?: unknown;
};

function readFirstFieldErrorMessage(errors: unknown): string | null {
  if (!Array.isArray(errors)) {
    return null;
  }

  for (const entry of errors) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      "message" in entry &&
      typeof (entry as { message: unknown }).message === "string"
    ) {
      return (entry as { message: string }).message;
    }
  }

  return null;
}

export async function readApiErrorMessage(
  response: JsonReadableResponse,
  fallback: string
): Promise<string> {
  const cloned = response.clone();
  let body: unknown;
  try {
    body = await cloned.json();
  } catch {
    return fallback;
  }

  if (body === null || typeof body !== "object") {
    return fallback;
  }

  const { detail, errors, title } = body as ProblemDetailsBody;

  const fieldErrorMessage = readFirstFieldErrorMessage(errors);
  if (fieldErrorMessage) {
    return fieldErrorMessage;
  }

  if (typeof detail === "string" && detail.length > 0) {
    return detail;
  }

  if (typeof title === "string" && title.length > 0) {
    return title;
  }

  return fallback;
}
