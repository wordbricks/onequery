import { ConnectError } from "@connectrpc/connect";

export function toUserMessage(error: unknown, fallback: string): string {
  if (error instanceof ConnectError) {
    return error.rawMessage;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}
