import { normalizeDeviceUserCode } from "@onequery/base/device-auth";
import type { Auth } from "@onequery/server/auth";
import type { Context } from "hono";
import { z } from "zod";

import * as cliBrowserApp from "../app";
import { buildCliRequestLogDetails, logCliEvent } from "../observability";
import {
  readBetterAuthErrorDetail,
  readBetterAuthErrorStatus,
} from "./device-transport";

const DEVICE_PAGE_PATH = "/device";

const BrowserSessionSchema = z.object({
  user: z.object({
    email: z.email(),
  }),
});

const DeviceVerifySchema = z.object({
  status: z.enum(["pending", "approved", "denied"]),
  user_code: z.string(),
});

type DeviceVerificationResult =
  | {
      kind: "verified";
      status: z.infer<typeof DeviceVerifySchema>["status"];
      userCode: string;
    }
  | {
      kind: "invalid";
      message: string;
    };

const DeviceVerifyApiResponseSchema = z.object({
  status: DeviceVerifySchema.shape.status,
  userCode: z.string().min(1),
});

const DeviceDecisionResponseSchema = z.object({
  message: z.string().min(1),
  title: z.string().min(1),
});

type DeviceDecisionConfig = {
  targetPath: "/api/auth/device/approve" | "/api/auth/device/deny";
  successEvent: "auth.device.approved" | "auth.device.denied";
  successTitle: string;
  successMessage: string;
};

type CliRouteEnv = cliBrowserApp.CliRouteEnv;
type CreateCliAppOptions = cliBrowserApp.CreateCliAppOptions;
type CliBrowserContext = Context<CliRouteEnv>;

export function createDeviceAuthorizationBrowserRoute(
  input: CreateCliAppOptions
) {
  return (
    cliBrowserApp
      .createCliBrowserApp(input)
      .get("/", async (c) => {
        const userCode = normalizeUserCode(c.req.query("user_code"));
        return c.redirect(buildDevicePageUrl(c.req.url, userCode), 302);
      })
      .get("/approve", async (c) => {
        const userCode = normalizeUserCode(c.req.query("user_code"));
        if (!userCode) {
          return c.redirect(buildDevicePageUrl(c.req.url), 302);
        }

        const browserSession = await readBrowserSession(
          c.var.storage.auth,
          c.req.raw.headers
        );
        if (!browserSession) {
          logCliEvent({
            details: buildCliRequestLogDetails(c, {
              userCode,
            }),
            event: "auth.device.redirect_to_signin",
            level: "info",
          });
          return c.redirect(
            buildSigninUrl(c.req.url, c.var.runtime.auth.baseURL, userCode),
            302
          );
        }

        return c.redirect(buildDevicePageUrl(c.req.url, userCode), 302);
      })
      // Comment: browser presentation for the CLI device flow now lives in
      // `apps/web`; this worker route only exposes JSON state/effect endpoints.
      .get("/verify", async (c) => {
        const userCode = normalizeUserCode(c.req.query("user_code"));
        if (!userCode) {
          return c.json(
            {
              error: "Enter the code shown in your terminal to continue.",
            },
            400
          );
        }

        const verification = await verifyDeviceCode(
          c.var.storage.auth,
          c.req.raw,
          userCode
        );
        if (verification.kind === "invalid") {
          logCliEvent({
            details: buildCliRequestLogDetails(c, {
              userCode,
            }),
            event: "auth.device.verify_failed",
            level: "warn",
          });
          return c.json(
            {
              error: verification.message,
            },
            400
          );
        }

        return c.json(
          DeviceVerifyApiResponseSchema.parse({
            status: verification.status,
            userCode: verification.userCode,
          }),
          200
        );
      })
      .post("/approve", async (c) =>
        handleDeviceDecision(c, {
          successEvent: "auth.device.approved",
          successMessage:
            "Return to your terminal to continue. You can close this tab.",
          successTitle: "Device Approved",
          targetPath: "/api/auth/device/approve",
        })
      )
      .post("/deny", async (c) =>
        handleDeviceDecision(c, {
          successEvent: "auth.device.denied",
          successMessage: "The terminal login request was denied.",
          successTitle: "Device Denied",
          targetPath: "/api/auth/device/deny",
        })
      )
  );
}

async function handleDeviceDecision(
  c: CliBrowserContext,
  config: DeviceDecisionConfig
) {
  const userCode = normalizeUserCode(await readPostedUserCode(c.req.raw));
  if (!userCode) {
    return c.json(
      {
        error: "Enter the code shown in your terminal to continue.",
      },
      400
    );
  }

  const browserSession = await readBrowserSession(
    c.var.storage.auth,
    c.req.raw.headers
  );
  if (!browserSession) {
    return c.json(
      {
        error: "Sign in to continue.",
        signInUrl: buildSigninUrl(
          c.req.url,
          c.var.runtime.auth.baseURL,
          userCode
        ),
      },
      401
    );
  }

  try {
    const response = await callAuthEndpoint(c.var.storage.auth, c.req.raw, {
      payload: {
        userCode,
      },
      targetPath: config.targetPath,
    });

    if (!response.ok) {
      return c.json(
        {
          error: await readAuthErrorResponse(response),
        },
        toDeviceResponseStatus(response.status)
      );
    }

    logCliEvent({
      details: buildCliRequestLogDetails(c, {
        userCode,
        userEmail: browserSession.user.email,
      }),
      event: config.successEvent,
      level: "info",
    });

    return c.json(
      DeviceDecisionResponseSchema.parse({
        message: config.successMessage,
        title: config.successTitle,
      }),
      200
    );
  } catch (error) {
    return c.json(
      {
        error: readAuthErrorDescription(error),
      },
      readAuthErrorStatus(error)
    );
  }
}

async function readBrowserSession(auth: Auth, headers: Headers) {
  const session = await auth.api.getSession({ headers });
  const parsed = BrowserSessionSchema.safeParse(session);

  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

async function verifyDeviceCode(
  auth: Auth,
  request: Request,
  userCode: string
): Promise<DeviceVerificationResult> {
  try {
    const response = await callAuthEndpoint(auth, request, {
      method: "GET",
      query: {
        user_code: userCode,
      },
      targetPath: "/api/auth/device",
    });

    if (!response.ok) {
      return {
        kind: "invalid",
        message: await readAuthErrorResponse(response),
      };
    }

    const parsed = DeviceVerifySchema.safeParse(await response.json());

    if (!parsed.success) {
      return {
        kind: "invalid",
        message: "The device code could not be verified. Try again.",
      };
    }

    return {
      kind: "verified",
      status: parsed.data.status,
      userCode: normalizeUserCode(parsed.data.user_code) ?? userCode,
    };
  } catch (error) {
    return {
      kind: "invalid",
      message: readAuthErrorDescription(error),
    };
  }
}

function createAuthProxyRequest(
  request: Request,
  options: {
    targetPath: string;
    method?: string;
    payload?: unknown;
    query?: Record<string, string>;
  }
) {
  const url = new URL(request.url);
  url.pathname = options.targetPath;

  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const headers = new Headers(request.headers);
  headers.delete("content-length");

  if (options.payload === undefined) {
    headers.delete("content-type");
  } else {
    headers.set("content-type", "application/json");
  }

  return new Request(url, {
    body:
      options.payload === undefined
        ? undefined
        : JSON.stringify(options.payload),
    headers,
    method: options.method ?? request.method,
  });
}

async function callAuthEndpoint(
  auth: Auth,
  request: Request,
  options: {
    targetPath: string;
    method?: string;
    payload?: unknown;
    query?: Record<string, string>;
  }
) {
  return auth.handler(createAuthProxyRequest(request, options));
}

async function readAuthErrorResponse(response: Response) {
  try {
    const detail = readBetterAuthErrorDetail(await response.json());
    if (detail) {
      return detail;
    }
  } catch {
    // Comment: Better Auth normally returns JSON errors here, but keep a
    // fallback in case an upstream proxy or middleware returns an empty body.
  }

  return `Request failed with status ${response.status}`;
}

function buildSigninUrl(requestUrl: string, baseUrl: string, userCode: string) {
  const signInUrl = new URL("/signin", baseUrl);
  signInUrl.searchParams.set(
    "redirect",
    buildRelativeDevicePath(requestUrl, userCode)
  );
  return signInUrl.toString();
}

function buildDevicePageUrl(requestUrl: string, userCode?: string | null) {
  const url = new URL(DEVICE_PAGE_PATH, requestUrl);
  if (userCode) {
    url.searchParams.set("user_code", userCode);
  }
  return url.toString();
}

function buildRelativeDevicePath(requestUrl: string, userCode: string) {
  const url = new URL(DEVICE_PAGE_PATH, requestUrl);
  url.searchParams.set("user_code", userCode);
  return `${url.pathname}${url.search}`;
}

async function readPostedUserCode(request: Request) {
  const formData = await request.formData();
  const value = formData.get("user_code");

  return typeof value === "string" ? value : null;
}

function normalizeUserCode(value: string | null | undefined) {
  return normalizeDeviceUserCode(value) ?? null;
}

function readAuthErrorDescription(error: unknown) {
  const detail = readBetterAuthErrorDetail(error);
  if (detail) {
    return detail;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "The device code is invalid or expired. Start `onequery auth login` again.";
}

function readAuthErrorStatus(
  error: unknown
): 400 | 401 | 403 | 404 | 409 | 429 | 500 {
  const status = readBetterAuthErrorStatus(error);
  if (status !== null) {
    return toDeviceResponseStatus(status);
  }

  return 400;
}

function toDeviceResponseStatus(
  status: number
): 400 | 401 | 403 | 404 | 409 | 429 | 500 {
  if (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 409 ||
    status === 429 ||
    status === 500
  ) {
    return status;
  }

  return 500;
}
