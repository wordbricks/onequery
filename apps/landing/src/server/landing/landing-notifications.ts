import { Result, TaggedError } from "better-result";

export const LEAD_CAPTURE_SOURCE = "onequery_landing";

export type LandingNotificationDelivery =
  | {
      kind: "local-dev-null-sink";
    }
  | {
      kind: "slack-webhook";
      webhookUrl: string;
    }
  | {
      kind: "unconfigured";
    };

export class LandingNotificationConfigurationError extends TaggedError(
  "LandingNotificationConfigurationError"
)<{
  message: string;
}>() {}

export class LandingNotificationRequestError extends TaggedError(
  "LandingNotificationRequestError"
)<{
  message: string;
  cause: unknown;
}>() {}

export class LandingNotificationResponseError extends TaggedError(
  "LandingNotificationResponseError"
)<{
  message: string;
  status: number;
}>() {}

export type LandingNotificationError =
  | LandingNotificationConfigurationError
  | LandingNotificationRequestError
  | LandingNotificationResponseError;

type SlackPlainText = {
  type: "plain_text";
  text: string;
};

type SlackMarkdownText = {
  type: "mrkdwn";
  text: string;
};

type SlackHeaderBlock = {
  type: "header";
  text: SlackPlainText;
};

type SlackSectionBlock =
  | {
      type: "section";
      fields: readonly SlackMarkdownText[];
    }
  | {
      type: "section";
      text: SlackMarkdownText;
    };

type SlackContextBlock = {
  type: "context";
  elements: readonly SlackMarkdownText[];
};

export type LandingNotificationPayload = {
  text: string;
  blocks: readonly (SlackContextBlock | SlackHeaderBlock | SlackSectionBlock)[];
};

type LandingLogger = Pick<typeof console, "error" | "info">;
export type LandingNotificationRuntime = {
  logger: LandingLogger;
  transport: typeof fetch;
};

export const defaultLandingNotificationRuntime: LandingNotificationRuntime = {
  logger: console,
  transport: fetch,
};

function escapeSlackText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function createProductUpdatesNotification(
  email: string
): LandingNotificationPayload {
  return {
    text: `New product updates signup: ${email}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "New product updates signup" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Email*\n${escapeSlackText(email)}` },
          { type: "mrkdwn", text: `*Source*\n${LEAD_CAPTURE_SOURCE}` },
        ],
      },
    ],
  };
}

export function createContactNotification(input: {
  email: string;
  message: string;
  name: string;
}): LandingNotificationPayload {
  return {
    text: `New contact request from ${input.name} (${input.email})`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "New contact request" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Name*\n${escapeSlackText(input.name)}` },
          { type: "mrkdwn", text: `*Email*\n${escapeSlackText(input.email)}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Message*\n${escapeSlackText(input.message)}`,
        },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Source: ${LEAD_CAPTURE_SOURCE}` }],
      },
    ],
  };
}

export async function deliverLandingNotification(
  input: {
    delivery: LandingNotificationDelivery;
    payload: LandingNotificationPayload;
  },
  runtime: LandingNotificationRuntime
): Promise<Result<void, LandingNotificationError>> {
  const { delivery, payload } = input;
  const { logger, transport } = runtime;

  if (delivery.kind === "local-dev-null-sink") {
    logger.info({
      event: "landing_service.local_notification_fallback",
      payload,
    });
    return Result.ok(undefined);
  }

  if (delivery.kind === "unconfigured") {
    return Result.err(
      new LandingNotificationConfigurationError({
        message: "Landing ingest is not configured",
      })
    );
  }

  const responseResult = await Result.tryPromise({
    try: () =>
      transport(delivery.webhookUrl, {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    catch: (cause: unknown) =>
      new LandingNotificationRequestError({
        cause,
        message: `Failed to send landing notification: ${toErrorMessage(cause)}`,
      }),
  });
  if (responseResult.isErr()) {
    return Result.err(responseResult.error);
  }

  const response = responseResult.value;

  if (response.ok) {
    return Result.ok(undefined);
  }

  const upstream = (await Result.tryPromise(() => response.text())).unwrapOr(
    ""
  );
  // Public lead-capture requests should not leak upstream webhook
  // details back to the browser, so worker errors stay generic.
  logger.error({
    event: "landing_service.slack_webhook_error",
    message: upstream.slice(0, 500),
    status: response.status,
  });
  return Result.err(
    new LandingNotificationResponseError({
      message: "Failed to deliver notification",
      status: response.status,
    })
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
