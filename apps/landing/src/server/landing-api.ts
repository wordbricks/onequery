import { Result } from "better-result";
import { z } from "zod";

import {
  ContactRequestSchema,
  ProductUpdatesRequestSchema,
} from "./landing-schemas";
import {
  createContactNotification,
  createProductUpdatesNotification,
  deliverLandingNotification,
  LandingNotificationConfigurationError,
} from "./landing/landing-notifications";
import type {
  LandingNotificationDelivery,
  LandingNotificationError,
} from "./landing/landing-notifications";

type LandingErrorResponseBase<Code extends string> = {
  code: Code;
  message: string;
};

export type LandingInternalErrorResponse =
  LandingErrorResponseBase<"internal_error">;

export type LandingValidationErrorResponse =
  LandingErrorResponseBase<"validation_error"> & {
    fieldErrors: Record<string, string[]>;
  };

export type LandingServiceUnavailableErrorResponse =
  LandingErrorResponseBase<"service_unavailable">;

export type LandingProductUpdatesResponse = {
  email: string;
};

export type LandingContactResponse = Record<never, never>;

export type LandingProductUpdatesInput = z.infer<
  typeof ProductUpdatesRequestSchema
>;

export type LandingContactInput = z.infer<typeof ContactRequestSchema>;

export type LandingApiErrorResponse =
  | LandingInternalErrorResponse
  | LandingServiceUnavailableErrorResponse
  | LandingValidationErrorResponse;

export interface LandingWorkerBindings {
  // Local dev can intentionally omit the webhook binding and use the loopback
  // fallback sink, but deployed environments still require it.
  LANDING_SLACK_WEBHOOK_URL?: string;
}

type LandingRequestContext = {
  bindings: LandingWorkerBindings;
  request: Request;
};

function isLoopbackHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

function resolveLandingNotificationDelivery(input: {
  hostname: string;
  slackWebhookUrl: string | undefined;
}): LandingNotificationDelivery {
  const webhookUrl = input.slackWebhookUrl?.trim();
  if (webhookUrl) {
    return {
      kind: "slack-webhook",
      webhookUrl,
    };
  }

  if (isLoopbackHostname(input.hostname)) {
    return {
      kind: "local-dev-null-sink",
    };
  }

  return {
    kind: "unconfigured",
  };
}

function resolveLandingNotificationDeliveryFromRequest({
  bindings,
  request,
}: LandingRequestContext) {
  return resolveLandingNotificationDelivery({
    hostname: new URL(request.url).hostname,
    slackWebhookUrl: bindings.LANDING_SLACK_WEBHOOK_URL,
  });
}

type LandingValidationIssue = {
  message: string;
  path: readonly PropertyKey[];
};

type LandingValidationError = {
  issues: readonly LandingValidationIssue[];
};

function readLandingValidationFieldKey(path: readonly PropertyKey[]) {
  if (path.length === 0) {
    return "_form";
  }

  return path.map(String).join(".");
}

function readLandingValidationErrorResponse(
  error: LandingValidationError
): LandingValidationErrorResponse {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const fieldKey = readLandingValidationFieldKey(issue.path);
    const existingMessages = fieldErrors[fieldKey] ?? [];

    fieldErrors[fieldKey] = [...existingMessages, issue.message];
  }

  const message = error.issues[0]?.message ?? "Invalid request";

  return {
    code: "validation_error",
    fieldErrors,
    message,
  };
}

function createJsonResponse<T>(
  body: T,
  input: {
    requestId: string;
    status: number;
  }
) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-robots-tag": "noindex",
      "x-request-id": input.requestId,
    },
    status: input.status,
  });
}

function createValidationErrorResponse(
  body: LandingValidationErrorResponse,
  requestId: string
) {
  return createJsonResponse(body, {
    requestId,
    status: 400,
  });
}

function createInternalErrorResponse(requestId: string) {
  return createJsonResponse<LandingInternalErrorResponse>(
    {
      code: "internal_error",
      message: "Internal server error",
    },
    {
      requestId,
      status: 500,
    }
  );
}

function createServiceUnavailableResponse(
  error: LandingNotificationError,
  requestId: string
) {
  const message = LandingNotificationConfigurationError.is(error)
    ? error.message
    : "Failed to deliver notification";

  return createJsonResponse<LandingServiceUnavailableErrorResponse>(
    {
      code: "service_unavailable",
      message,
    },
    {
      requestId,
      status: 503,
    }
  );
}

function createBodyValidationError(
  message: string
): LandingValidationErrorResponse {
  return {
    code: "validation_error",
    fieldErrors: {
      _form: [message],
    },
    message,
  };
}

function readFormDataBody(formData: FormData) {
  return Object.fromEntries(
    Array.from(formData.entries()).map(([key, value]) => [key, String(value)])
  );
}

async function readRequestBody(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    try {
      return readFormDataBody(await request.formData());
    } catch {
      return createBodyValidationError("Invalid form request body");
    }
  }

  if (contentType.length > 0 && !contentType.includes("application/json")) {
    return createBodyValidationError("Unsupported request content type");
  }

  try {
    return await request.json();
  } catch {
    return createBodyValidationError("Invalid JSON request body");
  }
}

async function readValidatedRequestBody<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<z.infer<T> | LandingValidationErrorResponse> {
  const body = await readRequestBody(request);
  if (isValidationErrorResponse(body)) {
    return body;
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return readLandingValidationErrorResponse(result.error);
  }

  return result.data;
}

function isValidationErrorResponse(
  input: unknown
): input is LandingValidationErrorResponse {
  return (
    typeof input === "object" &&
    input !== null &&
    "code" in input &&
    input.code === "validation_error"
  );
}

function createRequestId() {
  return crypto.randomUUID();
}

export async function submitProductUpdatesLead(
  input: LandingProductUpdatesInput,
  context: LandingRequestContext
) {
  const normalizedEmail = input.email.toLowerCase();
  const result = await deliverLandingNotification({
    delivery: resolveLandingNotificationDeliveryFromRequest(context),
    notificationType: "product_updates",
    payload: createProductUpdatesNotification(normalizedEmail),
  });
  if (result.isErr()) {
    return Result.err(result.error);
  }

  return Result.ok<LandingProductUpdatesResponse>({
    email: normalizedEmail,
  });
}

export async function submitContactLead(
  input: LandingContactInput,
  context: LandingRequestContext
) {
  const normalizedEmail = input.email.toLowerCase();
  const result = await deliverLandingNotification({
    delivery: resolveLandingNotificationDeliveryFromRequest(context),
    notificationType: "contact",
    payload: createContactNotification({
      email: normalizedEmail,
      message: input.message,
      name: input.name,
    }),
  });
  if (result.isErr()) {
    return Result.err(result.error);
  }

  return Result.ok<LandingContactResponse>({});
}

export async function handleProductUpdatesRequest({
  bindings,
  request,
}: LandingRequestContext) {
  const requestId = createRequestId();

  try {
    const input = await readValidatedRequestBody(
      request,
      ProductUpdatesRequestSchema
    );
    if (isValidationErrorResponse(input)) {
      return createValidationErrorResponse(input, requestId);
    }

    const result = await submitProductUpdatesLead(input, {
      bindings,
      request,
    });
    if (result.isErr()) {
      return createServiceUnavailableResponse(result.error, requestId);
    }

    return createJsonResponse<LandingProductUpdatesResponse>(result.value, {
      requestId,
      status: 200,
    });
  } catch (error) {
    console.error(
      {
        err: error,
        event: "landing.request.failed",
        path: new URL(request.url).pathname,
        requestId,
      },
      "landing request failed"
    );
    return createInternalErrorResponse(requestId);
  }
}

export async function handleContactRequest({
  bindings,
  request,
}: LandingRequestContext) {
  const requestId = createRequestId();

  try {
    const input = await readValidatedRequestBody(request, ContactRequestSchema);
    if (isValidationErrorResponse(input)) {
      return createValidationErrorResponse(input, requestId);
    }

    const result = await submitContactLead(input, {
      bindings,
      request,
    });
    if (result.isErr()) {
      return createServiceUnavailableResponse(result.error, requestId);
    }

    return createJsonResponse<LandingContactResponse>(result.value, {
      requestId,
      status: 200,
    });
  } catch (error) {
    console.error(
      {
        err: error,
        event: "landing.request.failed",
        path: new URL(request.url).pathname,
        requestId,
      },
      "landing request failed"
    );
    return createInternalErrorResponse(requestId);
  }
}
