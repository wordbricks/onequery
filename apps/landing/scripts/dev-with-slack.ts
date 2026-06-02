import {
  createServer as createEmulatorServer,
  filePersistence,
  serve,
} from "@emulators/core";
import type { StoreSnapshot } from "@emulators/core";
import { getSlackStore, slackPlugin } from "@emulators/slack";
import type { SlackMessage } from "@emulators/slack";
import { dev } from "astro";

const DEFAULT_SLACK_EMULATOR_PORT = "4003";
const DEFAULT_SLACK_EMULATOR_STATE_PATH = ".emulate/landing-slack.json";
const SLACK_EMULATOR_WEBHOOK_PATH =
  "/services/T000000001/B000000001/X000000001";
const SLACK_EMULATOR_TOKEN = "xoxb-local-test";
const MUTATING_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

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
      ? await createSlackEmulator(slackPort)
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

async function createSlackEmulator(port: string) {
  try {
    return await createPersistentSlackEmulator({
      baseUrl: readSlackBaseUrl(port),
      port: readPortNumber(port),
      statePath: DEFAULT_SLACK_EMULATOR_STATE_PATH,
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

async function createPersistentSlackEmulator(input: {
  baseUrl: string;
  port: number;
  statePath: string;
}): Promise<SlackDevEmulator> {
  const persistence = filePersistence(input.statePath);
  const { app, store } = createEmulatorServer(slackPlugin, {
    baseUrl: input.baseUrl,
    fallbackUser: {
      id: 1,
      login: "U000000001",
      scopes: [],
    },
    port: input.port,
    tokens: {
      [SLACK_EMULATOR_TOKEN]: {
        id: 1,
        login: "U000000001",
        scopes: [],
      },
      test_token_admin: {
        id: 1,
        login: "U000000001",
        scopes: [],
      },
    },
  });

  const restored = await restoreSlackState({
    persistence,
    statePath: input.statePath,
    store,
  });
  if (!restored) {
    slackPlugin.seed?.(store, input.baseUrl);
    await persistence.save(JSON.stringify(store.snapshot()));
  }

  const seenMessageTimestamps = new Set(
    readSlackMessages(store).map((message) => message.ts)
  );
  let pendingSave = Promise.resolve();

  function enqueueSave() {
    pendingSave = pendingSave
      .catch(() => undefined)
      .then(() => persistence.save(JSON.stringify(store.snapshot())))
      .catch((error: unknown) => {
        console.warn(
          `[dev] Failed to persist Slack emulator state: ${toErrorMessage(
            error
          )}`
        );
      });
  }

  function logNewMessages() {
    for (const message of readSlackMessages(store)) {
      if (seenMessageTimestamps.has(message.ts)) {
        continue;
      }

      seenMessageTimestamps.add(message.ts);
      console.info(`[dev] Slack message received: ${message.text}`);
    }
  }

  const httpServer = serve({
    fetch: async (request) => {
      const response = await app.fetch(request);

      if (MUTATING_METHODS.has(request.method)) {
        logNewMessages();
        enqueueSave();
      }

      return response;
    },
    port: input.port,
  });

  console.info(`[dev] Slack emulator state: ${input.statePath}`);

  return {
    async close() {
      await pendingSave;
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function restoreSlackState(input: {
  persistence: ReturnType<typeof filePersistence>;
  statePath: string;
  store: {
    restore: (snapshot: StoreSnapshot) => void;
  };
}) {
  const raw = await input.persistence.load();
  if (!raw) {
    return false;
  }

  try {
    input.store.restore(JSON.parse(raw) as StoreSnapshot);
    return true;
  } catch (error) {
    console.warn(
      `[dev] Ignoring unreadable Slack emulator state at ${
        input.statePath
      }: ${toErrorMessage(error)}`
    );
    return false;
  }
}

function readSlackMessages(store: Parameters<typeof getSlackStore>[0]) {
  return getSlackStore(store)
    .messages.all()
    .filter((message): message is SlackMessage => message.type === "message")
    .sort((left, right) => left.ts.localeCompare(right.ts));
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
