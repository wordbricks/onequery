import { problemDetailsHandler } from "hono-problem-details";
import { HTTPException } from "hono/http-exception";

export interface ServerErrorReportContext {
  source: string;
  method?: string;
  url?: string;
  path?: string;
  status?: number;
}

export type ServerErrorReporter = (
  error: unknown,
  context: ServerErrorReportContext
) => void | Promise<void>;

let serverErrorReporter: ServerErrorReporter | null = null;

function readErrorStatus(error: unknown): number | undefined {
  if (error instanceof HTTPException) {
    return error.status;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }
  return undefined;
}

function readPath(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}

export function setServerErrorReporter(
  reporter: ServerErrorReporter | null
): void {
  serverErrorReporter = reporter;
}

export function resetServerErrorReporter(): void {
  serverErrorReporter = null;
}

export async function reportServerError(
  error: unknown,
  context: ServerErrorReportContext
): Promise<void> {
  if (!serverErrorReporter) {
    return;
  }

  try {
    await serverErrorReporter(error, context);
  } catch (reportingError) {
    console.error(
      "[server][observability] Failed to report application error",
      reportingError
    );
  }
}

const defaultProblemHandler = problemDetailsHandler();

export function createProblemDetailsErrorHandler(source: string) {
  return async (
    error: Error,
    c: Parameters<typeof defaultProblemHandler>[1]
  ) => {
    const status = readErrorStatus(error);
    if (status === undefined || status >= 500) {
      await reportServerError(error, {
        method: c.req.method,
        path: readPath(c.req.url),
        source,
        status,
        url: c.req.url,
      });
    }

    return defaultProblemHandler(error, c);
  };
}
