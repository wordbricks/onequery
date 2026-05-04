import { Result, TaggedError } from "better-result";

const LEAD_CAPTURE_SOURCE = "onequery_landing";

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

type LandingNotificationPayload = {
  text: string;
  blocks: readonly (SlackContextBlock | SlackHeaderBlock | SlackSectionBlock)[];
};

type LandingNotificationType = "contact" | "product_updates";

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

export async function deliverLandingNotification(input: {
  delivery: LandingNotificationDelivery;
  notificationType: LandingNotificationType;
  payload: LandingNotificationPayload;
}): Promise<Result<void, LandingNotificationError>> {
  const { delivery, notificationType, payload } = input;

  if (delivery.kind === "local-dev-null-sink") {
    console.info(
      {
        delivery: delivery.kind,
        event: "landing.notification.delivered_local",
        notificationType,
      },
      "landing notification routed to local sink"
    );
    return Result.ok(undefined);
  }

  if (delivery.kind === "unconfigured") {
    console.error(
      {
        delivery: delivery.kind,
        event: "landing.notification.delivery_unconfigured",
        notificationType,
      },
      "landing notification delivery is unconfigured"
    );
    return Result.err(
      new LandingNotificationConfigurationError({
        message: "Landing ingest is not configured",
      })
    );
  }

  const responseResult = await Result.tryPromise({
    try: () =>
      fetch(delivery.webhookUrl, {
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
    console.error(
      {
        cause: responseResult.error.cause,
        delivery: delivery.kind,
        errorMessage: responseResult.error.message,
        event: "landing.notification.webhook_request_failed",
        notificationType,
      },
      "landing notification webhook request failed"
    );
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
  console.error(
    {
      delivery: delivery.kind,
      event: "landing.notification.webhook_rejected",
      notificationType,
      status: response.status,
      upstreamBodyPreview: upstream.slice(0, 500),
    },
    "landing notification webhook rejected"
  );
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
