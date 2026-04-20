import { create } from "@bufbuild/protobuf";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import { Code, ConnectError, createContextKey } from "@connectrpc/connect";
import { Result, TaggedError } from "better-result";

import {
  LandingService,
  SubmitContactResponseSchema,
  SubscribeProductUpdatesResponseSchema,
} from "../../connect/gen/onequery/landing/v1/landing_pb.js";

export const LEAD_CAPTURE_SOURCE = "onequery_landing";

export interface LandingServiceContext {
  slackWebhookUrl: string | null;
}

export const landingContextKey = createContextKey<LandingServiceContext>({
  slackWebhookUrl: null,
});

class LandingNotificationConfigurationError extends TaggedError(
  "LandingNotificationConfigurationError"
)<{
  message: string;
}>() {}

class LandingNotificationRequestError extends TaggedError(
  "LandingNotificationRequestError"
)<{
  message: string;
  cause: unknown;
}>() {}

class LandingNotificationResponseError extends TaggedError(
  "LandingNotificationResponseError"
)<{
  message: string;
  status: number;
}>() {}

type LandingNotificationError =
  | LandingNotificationConfigurationError
  | LandingNotificationRequestError
  | LandingNotificationResponseError;

function escapeSlackText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function postToSlack(
  slackWebhookUrl: string | null,
  payload: Record<string, unknown>
): Promise<Result<void, LandingNotificationError>> {
  if (!slackWebhookUrl) {
    return Result.err(
      new LandingNotificationConfigurationError({
        message: "Landing ingest is not configured",
      })
    );
  }

  const responseResult = await Result.tryPromise({
    try: () =>
      fetch(slackWebhookUrl, {
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
  // Comment: public lead-capture requests should not leak upstream webhook
  // details back to the browser, so worker errors stay generic.
  console.error({
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

function toLandingConnectError(error: LandingNotificationError) {
  if (LandingNotificationConfigurationError.is(error)) {
    return new ConnectError(error.message, Code.Unavailable);
  }

  return new ConnectError("Failed to deliver notification", Code.Unavailable);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

const landingServiceImpl: ServiceImpl<typeof LandingService> = {
  async subscribeProductUpdates(request, ctx) {
    const email = request.email.trim().toLowerCase();
    const { slackWebhookUrl } = ctx.values.get(landingContextKey);
    const delivery = await postToSlack(slackWebhookUrl, {
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
    });
    if (delivery.isErr()) {
      throw toLandingConnectError(delivery.error);
    }
    return create(SubscribeProductUpdatesResponseSchema, { email });
  },

  async submitContact(request, ctx) {
    const email = request.email.trim().toLowerCase();
    const name = request.name.trim();
    const message = request.message.trim();
    const { slackWebhookUrl } = ctx.values.get(landingContextKey);
    const delivery = await postToSlack(slackWebhookUrl, {
      text: `New contact request from ${name} (${email})`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "New contact request" },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Name*\n${escapeSlackText(name)}` },
            { type: "mrkdwn", text: `*Email*\n${escapeSlackText(email)}` },
          ],
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Message*\n${escapeSlackText(message)}`,
          },
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `Source: ${LEAD_CAPTURE_SOURCE}` },
          ],
        },
      ],
    });
    if (delivery.isErr()) {
      throw toLandingConnectError(delivery.error);
    }
    return create(SubmitContactResponseSchema, {});
  },
};

export function registerLandingRoutes(router: ConnectRouter) {
  router.service(LandingService, landingServiceImpl);
}
