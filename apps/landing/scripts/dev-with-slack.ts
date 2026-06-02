import { dev } from "astro";
import { createEmulator } from "emulate";

const DEFAULT_SLACK_EMULATOR_PORT = "4003";
const SLACK_EMULATOR_WEBHOOK_PATH =
  "/services/T000000001/B000000001/X000000001";
const SLACK_EMULATOR_TOKEN = "xoxb-local-test";

type SlackDevEmulator = {
  close: () => Promise<void>;
};

type DevArgs = {
  host?: boolean | string;
  open?: boolean | string;
  port?: number;
};

let shuttingDown = false;

async function main() {
  let server: Awaited<ReturnType<typeof dev>> | undefined;
  let slackEmulator: SlackDevEmulator | undefined;

  const configuredWebhookUrl = process.env.LANDING_SLACK_WEBHOOK_URL?.trim();
  const shouldStartSlackEmulator =
    process.env.LANDING_SLACK_EMULATOR !== "0" && !configuredWebhookUrl;
  const slackPort =
    process.env.LANDING_SLACK_EMULATOR_PORT ?? DEFAULT_SLACK_EMULATOR_PORT;
  const slackBaseUrl = readSlackBaseUrl(slackPort);
  const slackWebhookUrl =
    configuredWebhookUrl ??
    (shouldStartSlackEmulator
      ? `${slackBaseUrl}${SLACK_EMULATOR_WEBHOOK_PATH}`
      : undefined);

  try {
    slackEmulator = shouldStartSlackEmulator
      ? await ensureSlackEmulator({
          baseUrl: slackBaseUrl,
          port: slackPort,
        })
      : undefined;

    applyLandingSlackWebhookUrl(slackWebhookUrl);
    logSlackDevState({
      configuredWebhookUrl,
      slackBaseUrl,
      slackWebhookUrl,
    });

    const shutdownSignal = createShutdownSignal();
    server = await dev({
      root: process.cwd(),
      server: readDevServerConfig(process.argv.slice(2)),
    });

    await shutdownSignal;
  } finally {
    shuttingDown = true;
    await server?.stop();
    await slackEmulator?.close();
  }
}

async function ensureSlackEmulator(input: {
  baseUrl: string;
  port: string;
}): Promise<SlackDevEmulator | undefined> {
  if (await isSlackEmulatorReachable(input.baseUrl)) {
    console.info(`[dev] Reusing Slack emulator at ${input.baseUrl}/`);
    return undefined;
  }

  const emulator = await createSlackEmulator(input.port);

  return {
    close: () => emulator.close(),
  };
}

async function createSlackEmulator(port: string) {
  try {
    return await createEmulator({
      port: readPortNumber(port),
      service: "slack",
    });
  } catch (cause) {
    throw new Error(
      `Failed to start Slack emulator on port ${port}. Set LANDING_SLACK_EMULATOR_PORT to use another port.`,
      { cause }
    );
  }
}

function applyLandingSlackWebhookUrl(slackWebhookUrl: string | undefined) {
  if (slackWebhookUrl) {
    process.env.LANDING_SLACK_WEBHOOK_URL = slackWebhookUrl;
    return;
  }

  delete process.env.LANDING_SLACK_WEBHOOK_URL;
}

function logSlackDevState(input: {
  configuredWebhookUrl: string | undefined;
  slackBaseUrl: string;
  slackWebhookUrl: string | undefined;
}) {
  if (input.configuredWebhookUrl) {
    console.info("[dev] Using configured LANDING_SLACK_WEBHOOK_URL");
    return;
  }

  if (input.slackWebhookUrl) {
    console.info(`[dev] Slack emulator inspector: ${input.slackBaseUrl}/`);
    console.info(`[dev] Slack webhook: ${input.slackWebhookUrl}`);
    return;
  }

  console.info("[dev] Slack emulator disabled; local requests use null sink");
}

function readDevServerConfig(args: string[]) {
  const devArgs = readDevArgs(args);

  return {
    ...(devArgs.host === undefined ? {} : { host: devArgs.host }),
    ...(devArgs.open === undefined ? {} : { open: devArgs.open }),
    ...(devArgs.port === undefined ? {} : { port: devArgs.port }),
  };
}

function readDevArgs(args: string[]): DevArgs {
  const devArgs: DevArgs = {};

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--host") {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) {
        devArgs.host = next;
        index++;
      } else {
        devArgs.host = true;
      }
      continue;
    }

    if (arg?.startsWith("--host=")) {
      devArgs.host = arg.slice("--host=".length);
      continue;
    }

    if (arg === "--open") {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) {
        devArgs.open = next;
        index++;
      } else {
        devArgs.open = true;
      }
      continue;
    }

    if (arg?.startsWith("--open=")) {
      devArgs.open = arg.slice("--open=".length);
      continue;
    }

    if (arg === "--port" || arg === "-p") {
      devArgs.port = readPortArg(args[index + 1], arg);
      index++;
      continue;
    }

    if (arg?.startsWith("--port=")) {
      devArgs.port = readPortArg(arg.slice("--port=".length), "--port");
      continue;
    }

    if (arg?.startsWith("-p") && arg.length > 2) {
      devArgs.port = readPortArg(arg.slice(2), "-p");
    }
  }

  return devArgs;
}

function readPortArg(port: string | undefined, flag: string) {
  if (!port) {
    throw new Error(`Missing value for ${flag}`);
  }

  return readPortNumber(port);
}

async function isSlackEmulatorReachable(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const response = await fetch(`${url}/api/team.info`, {
      body: "{}",
      headers: {
        Authorization: `Bearer ${SLACK_EMULATOR_TOKEN}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });
    const body = (await response.json()) as { ok?: unknown };
    return response.ok && body.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function readSlackBaseUrl(port: string) {
  return `http://localhost:${readPortNumber(port)}`;
}

function readPortNumber(port: string) {
  const value = Number.parseInt(port, 10);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`Invalid port: ${port}`);
  }

  return value;
}

function createShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    function handleShutdown() {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;
      resolve();
    }

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, handleShutdown);
    }
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
