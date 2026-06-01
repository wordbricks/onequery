import { Result } from "better-result";
import { z } from "zod";

import {
  createContactNotification,
  createProductUpdatesNotification,
  deliverNotification,
  NotificationConfigurationError,
} from "./notifications";
import type { NotificationDelivery, NotificationError } from "./notifications";
import { ContactRequestSchema, ProductUpdatesRequestSchema } from "./schemas";

type ErrorResponseBase<Code extends string> = {
  code: Code;
  message: string;
};

export type InternalErrorResponse = ErrorResponseBase<"internal_error">;

export type ValidationErrorResponse = ErrorResponseBase<"validation_error"> & {
  fieldErrors: Record<string, string[]>;
};

export type ServiceUnavailableErrorResponse =
  ErrorResponseBase<"service_unavailable">;

export type ProductUpdatesResponse = {
  email: string;
};

export type ContactResponse = Record<never, never>;

export type ProductUpdatesInput = z.infer<typeof ProductUpdatesRequestSchema>;

export type ContactInput = z.infer<typeof ContactRequestSchema>;

export type ApiErrorResponse =
  | InternalErrorResponse
  | ServiceUnavailableErrorResponse
  | ValidationErrorResponse;

type RequestContext = {
  request: Request;
  // Local dev can intentionally omit the webhook and use the loopback fallback
  // sink, but deployed environments still require it.
  slackWebhookUrl?: string;
};

type LeadSubmission<Input, Body> = (
  input: Input,
  context: RequestContext
) => Promise<Result<Body, NotificationError>>;

function isLoopbackHostname(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

function resolveNotificationDelivery(input: {
  hostname: string;
  slackWebhookUrl: string | undefined;
}): NotificationDelivery {
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

function resolveNotificationDeliveryFromRequest({
  request,
  slackWebhookUrl,
}: RequestContext) {
  return resolveNotificationDelivery({
    hostname: new URL(request.url).hostname,
    slackWebhookUrl,
  });
}

type ValidationIssue = {
  message: string;
  path: readonly PropertyKey[];
};

type ValidationError = {
  issues: readonly ValidationIssue[];
};

function readValidationFieldKey(path: readonly PropertyKey[]) {
  if (path.length === 0) {
    return "_form";
  }

  return path.map(String).join(".");
}

function readValidationErrorResponse(
  error: ValidationError
): ValidationErrorResponse {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const fieldKey = readValidationFieldKey(issue.path);
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
  body: ValidationErrorResponse,
  requestId: string
) {
  return createJsonResponse(body, {
    requestId,
    status: 400,
  });
}

function createInternalErrorResponse(requestId: string) {
  return createJsonResponse<InternalErrorResponse>(
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
  error: NotificationError,
  requestId: string
) {
  const message = NotificationConfigurationError.is(error)
    ? error.message
    : "Failed to deliver notification";

  return createJsonResponse<ServiceUnavailableErrorResponse>(
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

function createBodyValidationError(message: string): ValidationErrorResponse {
  return {
    code: "validation_error",
    fieldErrors: {
      _form: [message],
    },
    message,
  };
}

function readFormDataBody(formData: FormData) {
  return Object.fromEntries(formData.entries());
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
): Promise<z.infer<T> | ValidationErrorResponse> {
  const body = await readRequestBody(request);
  if (isValidationErrorResponse(body)) {
    return body;
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return readValidationErrorResponse(result.error);
  }

  return result.data;
}

function isValidationErrorResponse(
  input: unknown
): input is ValidationErrorResponse {
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
  input: ProductUpdatesInput,
  context: RequestContext
) {
  const normalizedEmail = input.email.toLowerCase();
  const result = await deliverNotification({
    delivery: resolveNotificationDeliveryFromRequest(context),
    notificationType: "product_updates",
    payload: createProductUpdatesNotification(normalizedEmail),
  });
  if (result.isErr()) {
    return Result.err(result.error);
  }

  return Result.ok<ProductUpdatesResponse>({
    email: normalizedEmail,
  });
}

export async function submitContactLead(
  input: ContactInput,
  context: RequestContext
) {
  const normalizedEmail = input.email.toLowerCase();
  const result = await deliverNotification({
    delivery: resolveNotificationDeliveryFromRequest(context),
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

  return Result.ok<ContactResponse>({});
}

async function handleLeadRequest<TSchema extends z.ZodType, Body>(input: {
  context: RequestContext;
  schema: TSchema;
  submit: LeadSubmission<z.infer<TSchema>, Body>;
}) {
  const requestId = createRequestId();
  const { context, schema, submit } = input;
  const { request } = context;

  try {
    const requestBody = await readValidatedRequestBody(request, schema);
    if (isValidationErrorResponse(requestBody)) {
      return createValidationErrorResponse(requestBody, requestId);
    }

    const result = await submit(requestBody, context);
    if (result.isErr()) {
      return createServiceUnavailableResponse(result.error, requestId);
    }

    return createJsonResponse<Body>(result.value, {
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

export function handleProductUpdatesRequest(context: RequestContext) {
  return handleLeadRequest({
    context,
    schema: ProductUpdatesRequestSchema,
    submit: submitProductUpdatesLead,
  });
}

export function handleContactRequest(context: RequestContext) {
  return handleLeadRequest({
    context,
    schema: ContactRequestSchema,
    submit: submitContactLead,
  });
}
