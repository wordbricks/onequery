import {
  getFirstLeadCaptureError,
  LEAD_CAPTURE_SOURCE,
  validateContactForm,
  validateProductUpdatesForm,
} from "./lead-capture";

type AssetFetcher = {
  fetch(request: Request): Promise<Response>;
};

type LandingWorkerEnv = {
  ASSETS: AssetFetcher;
  LANDING_SLACK_WEBHOOK_URL?: string;
};

function createApiResponse(
  payload: object,
  status: number,
  init: ResponseInit = {}
) {
  const headers = new Headers(init.headers);
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Allow-Methods", "OPTIONS, POST");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
    status,
  });
}

function createMethodNotAllowedResponse() {
  return createApiResponse({ error: "Method not allowed" }, 405, {
    headers: {
      Allow: "OPTIONS, POST",
    },
  });
}

function readSlackWebhookUrl(env: LandingWorkerEnv) {
  return env.LANDING_SLACK_WEBHOOK_URL?.trim() || null;
}

function escapeSlackText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function postSlackMessage(
  env: LandingWorkerEnv,
  payload: Record<string, unknown>
) {
  const slackWebhookUrl = readSlackWebhookUrl(env);
  if (!slackWebhookUrl) {
    return createApiResponse(
      { error: "Landing ingest is not configured" },
      503
    );
  }

  const response = await fetch(slackWebhookUrl, {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (response.ok) {
    return null;
  }

  const message = await response.text().catch(() => "");

  // Comment: public lead-capture requests should not leak upstream webhook
  // details back to the browser, so worker errors stay generic.
  console.error("[landing-worker] slack webhook error", {
    message: message.slice(0, 500),
    status: response.status,
  });
  return createApiResponse({ error: "Failed to deliver notification" }, 502);
}

async function handleProductUpdates(
  request: Request,
  env: LandingWorkerEnv
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return createApiResponse({}, 204);
  }

  if (request.method !== "POST") {
    return createMethodNotAllowedResponse();
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return createApiResponse({ error: "Invalid JSON body" }, 400);
  }

  const result = validateProductUpdatesForm({
    email:
      "email" in payload && typeof payload.email === "string"
        ? payload.email
        : "",
  });
  if (!result.ok) {
    return createApiResponse(
      { error: getFirstLeadCaptureError(result.errors) },
      422
    );
  }

  const slackError = await postSlackMessage(env, {
    text: `New product updates signup: ${result.value.email}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "New product updates signup",
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Email*\n${escapeSlackText(result.value.email)}`,
          },
          {
            type: "mrkdwn",
            text: `*Source*\n${LEAD_CAPTURE_SOURCE}`,
          },
        ],
      },
    ],
  });

  if (slackError) {
    return slackError;
  }

  return createApiResponse({ ok: true }, 201);
}

async function handleContact(
  request: Request,
  env: LandingWorkerEnv
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return createApiResponse({}, 204);
  }

  if (request.method !== "POST") {
    return createMethodNotAllowedResponse();
  }

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return createApiResponse({ error: "Invalid JSON body" }, 400);
  }

  const result = validateContactForm({
    email:
      "email" in payload && typeof payload.email === "string"
        ? payload.email
        : "",
    message:
      "message" in payload && typeof payload.message === "string"
        ? payload.message
        : "",
    name:
      "name" in payload && typeof payload.name === "string" ? payload.name : "",
  });
  if (!result.ok) {
    return createApiResponse(
      { error: getFirstLeadCaptureError(result.errors) },
      422
    );
  }

  const slackError = await postSlackMessage(env, {
    text: `New contact request from ${result.value.name} (${result.value.email})`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "New contact request",
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Name*\n${escapeSlackText(result.value.name)}`,
          },
          {
            type: "mrkdwn",
            text: `*Email*\n${escapeSlackText(result.value.email)}`,
          },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Message*\n${escapeSlackText(result.value.message)}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Source: ${LEAD_CAPTURE_SOURCE}`,
          },
        ],
      },
    ],
  });

  if (slackError) {
    return slackError;
  }

  return createApiResponse({ ok: true }, 201);
}

export default {
  async fetch(request: Request, env: LandingWorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/product-updates") {
      return handleProductUpdates(request, env);
    }

    if (url.pathname === "/api/contact") {
      return handleContact(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return createApiResponse({ error: "Not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
