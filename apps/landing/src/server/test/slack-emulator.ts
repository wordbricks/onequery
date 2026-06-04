import { createServer } from "node:net";

import { createEmulator } from "emulate";
import type { Emulator } from "emulate";

export const SLACK_EMULATOR_BOT_ID = "B000000001";
export const SLACK_EMULATOR_GENERAL_CHANNEL_ID = "C000000001";
export const SLACK_EMULATOR_TOKEN = "xoxb-local-test";

const SLACK_EMULATOR_WEBHOOK_PATH =
  "/services/T000000001/B000000001/X000000001";

export type SlackEmulatorMessage = {
  blocks?: unknown;
  bot_id?: string;
  subtype?: string;
  text: string;
  ts: string;
  type: "message";
  user: string;
};

type SlackHistoryResponse =
  | {
      has_more: boolean;
      messages: SlackEmulatorMessage[];
      ok: true;
      response_metadata: { next_cursor: string };
    }
  | {
      error: string;
      ok: false;
    };

export type SlackEmulatorHarness = {
  close: () => Promise<void>;
  readMessages: () => Promise<SlackEmulatorMessage[]>;
  reset: () => void;
  url: string;
  webhookUrl: string;
};

export async function createSlackEmulatorHarness(): Promise<SlackEmulatorHarness> {
  const emulator = await createEmulator({
    port: await findAvailablePort(),
    service: "slack",
  });

  return {
    close: () => emulator.close(),
    readMessages: () => readSlackMessages(emulator),
    reset: () => emulator.reset(),
    url: emulator.url,
    webhookUrl: `${emulator.url}${SLACK_EMULATOR_WEBHOOK_PATH}`,
  };
}

async function readSlackMessages(emulator: Emulator) {
  const response = await fetch(`${emulator.url}/api/conversations.history`, {
    body: JSON.stringify({
      channel: SLACK_EMULATOR_GENERAL_CHANNEL_ID,
      limit: 100,
    }),
    headers: {
      Authorization: `Bearer ${SLACK_EMULATOR_TOKEN}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const body = (await response.json()) as SlackHistoryResponse;
  if (!body.ok) {
    throw new Error(`Failed to read Slack emulator history: ${body.error}`);
  }

  return body.messages;
}

export async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address !== "object" || address === null) {
        server.close();
        reject(new Error("Failed to allocate a local emulator port"));
        return;
      }

      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}
