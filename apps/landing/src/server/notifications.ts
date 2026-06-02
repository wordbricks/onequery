const LEAD_CAPTURE_SOURCE = "onequery_landing";

type SlackPlainText = {
  text: string;
  type: "plain_text";
};

type SlackMarkdownText = {
  text: string;
  type: "mrkdwn";
};

type SlackHeaderBlock = {
  text: SlackPlainText;
  type: "header";
};

type SlackSectionBlock =
  | {
      fields: readonly SlackMarkdownText[];
      type: "section";
    }
  | {
      text: SlackMarkdownText;
      type: "section";
    };

type SlackContextBlock = {
  elements: readonly SlackMarkdownText[];
  type: "context";
};

export type SlackNotificationPayload = {
  blocks: readonly (SlackContextBlock | SlackHeaderBlock | SlackSectionBlock)[];
  text: string;
};

export type NotificationType = "contact" | "product_updates";

function escapeSlackText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function createProductUpdatesNotification(
  email: string
): SlackNotificationPayload {
  return {
    blocks: [
      {
        text: { text: "New product updates signup", type: "plain_text" },
        type: "header",
      },
      {
        fields: [
          { text: `*Email*\n${escapeSlackText(email)}`, type: "mrkdwn" },
          { text: `*Source*\n${LEAD_CAPTURE_SOURCE}`, type: "mrkdwn" },
        ],
        type: "section",
      },
    ],
    text: `New product updates signup: ${email}`,
  };
}

export function createContactNotification(input: {
  email: string;
  message: string;
  name: string;
}): SlackNotificationPayload {
  return {
    blocks: [
      {
        text: { text: "New contact request", type: "plain_text" },
        type: "header",
      },
      {
        fields: [
          { text: `*Name*\n${escapeSlackText(input.name)}`, type: "mrkdwn" },
          { text: `*Email*\n${escapeSlackText(input.email)}`, type: "mrkdwn" },
        ],
        type: "section",
      },
      {
        text: {
          text: `*Message*\n${escapeSlackText(input.message)}`,
          type: "mrkdwn",
        },
        type: "section",
      },
      {
        elements: [{ text: `Source: ${LEAD_CAPTURE_SOURCE}`, type: "mrkdwn" }],
        type: "context",
      },
    ],
    text: `New contact request from ${input.name} (${input.email})`,
  };
}

export async function deliverSlackNotification(input: {
  notificationType: NotificationType;
  payload: SlackNotificationPayload;
  webhookUrl: string;
}): Promise<void> {
  let response: Response;

  try {
    response = await fetch(input.webhookUrl, {
      body: JSON.stringify(input.payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  } catch (cause) {
    const message = `Failed to send landing notification: ${toErrorMessage(
      cause
    )}`;
    console.error(
      {
        cause,
        errorMessage: message,
        event: "landing.notification.webhook_request_failed",
        notificationType: input.notificationType,
      },
      "landing notification webhook request failed"
    );
    throw new Error(message, { cause });
  }

  if (response.ok) {
    return;
  }

  const upstream = await readResponseText(response);
  console.error(
    {
      event: "landing.notification.webhook_rejected",
      notificationType: input.notificationType,
      status: response.status,
      upstreamBodyPreview: upstream.slice(0, 500),
    },
    "landing notification webhook rejected"
  );
  throw new Error("Failed to deliver notification");
}

async function readResponseText(response: Response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
