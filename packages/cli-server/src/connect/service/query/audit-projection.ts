import { syncAuditFeedProjection } from "@onequery/server/audit/feed";
import { Result, TaggedError } from "better-result";

import {
  buildCliRequestLogDetails,
  logCliEvent,
  toCliErrorMessage,
} from "../../../observability";

class CliQueryAuditProjectionSyncError extends TaggedError(
  "CliQueryAuditProjectionSyncError"
)<{
  cause: unknown;
  message: string;
  sourceKey: string;
}>() {
  constructor(input: { cause: unknown; sourceKey: string }) {
    super({
      cause: input.cause,
      message: `Failed to sync CLI query audit projection for source ${input.sourceKey}`,
      sourceKey: input.sourceKey,
    });
  }
}

export async function syncCliQueryAuditFeedProjection(input: {
  c: Parameters<typeof buildCliRequestLogDetails>[0];
  sourceKey: string;
}) {
  const result = await Result.tryPromise({
    catch: (cause) =>
      new CliQueryAuditProjectionSyncError({
        cause,
        sourceKey: input.sourceKey,
      }),
    try: () => syncAuditFeedProjection(input.c.var.storage.db),
  });

  if (result.isErr()) {
    logCliEvent({
      details: buildCliRequestLogDetails(input.c, {
        cause: toCliErrorMessage(result.error.cause),
        error: result.error.message,
        sourceKey: input.sourceKey,
      }),
      event: "cli.query.audit_projection_sync_failed",
      level: "warn",
    });
  }
}
