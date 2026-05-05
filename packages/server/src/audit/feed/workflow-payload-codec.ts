import { fromBinary } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import type {
  DataSourceStatus,
  ProviderType,
  WorkflowFamily,
} from "@onequery/db/server";
import {
  WorkflowDataSourceStatus,
  WorkflowSourceProvider,
} from "@onequery/proto-workflow/workflow/v1/common_pb";

import { AuditFeedProjectionCorruptPayloadError } from "./errors";
import type {
  AuditFeedProjectionPayloadEntity,
  AuditFeedProjectionPayloadRecord,
} from "./errors";

const auditFeedPayloadValidator = createValidator();

export function decodeValidatedAuditFeedPayload<Schema extends DescMessage>(
  schema: Schema,
  bytes: Buffer
): MessageShape<Schema> {
  const decoded = fromBinary(schema, bytes);
  const validation = auditFeedPayloadValidator.validate(schema, decoded);
  if (validation.kind !== "valid") {
    throw validation.error;
  }

  return decoded;
}

export function readAuditFeedProjectionPayload<T>(input: {
  entity: AuditFeedProjectionPayloadEntity;
  family: WorkflowFamily;
  payloadType: string;
  read: () => T;
  record: AuditFeedProjectionPayloadRecord;
}): T {
  try {
    return input.read();
  } catch (cause: unknown) {
    if (cause instanceof AuditFeedProjectionCorruptPayloadError) {
      throw cause;
    }

    throw new AuditFeedProjectionCorruptPayloadError({
      actionId: input.record.actionId,
      cause,
      commandId: input.record.commandId,
      entity: input.entity,
      eventId: input.record.eventId,
      family: input.family,
      payloadType: input.payloadType,
    });
  }
}

export function assertPayloadType(input: {
  actionId: string;
  actual: string;
  expected: string;
  family: WorkflowFamily;
}) {
  if (input.actual !== input.expected) {
    throw new Error(
      `${input.family} ${input.actionId} expected ${input.expected} payload but decoded ${input.actual}`
    );
  }
}

export function fromWorkflowSourceProvider(
  provider: WorkflowSourceProvider
): ProviderType {
  switch (provider) {
    case WorkflowSourceProvider.POSTGRES:
      return "postgres";
    case WorkflowSourceProvider.SUPABASE:
      return "supabase";
    case WorkflowSourceProvider.MYSQL:
      return "mysql";
    case WorkflowSourceProvider.MONGODB:
      return "mongodb";
    case WorkflowSourceProvider.BIGQUERY:
      return "bigquery";
    case WorkflowSourceProvider.LAMINAR:
      return "laminar";
    case WorkflowSourceProvider.AWS_ATHENA_CONNECTOR:
      return "aws_athena_connector";
    case WorkflowSourceProvider.GOOGLE_ANALYTICS:
      return "ga";
    case WorkflowSourceProvider.AMPLITUDE:
      return "amplitude";
    case WorkflowSourceProvider.MIXPANEL:
      return "mixpanel";
    case WorkflowSourceProvider.POSTHOG:
      return "posthog";
    case WorkflowSourceProvider.SENTRY:
      return "sentry";
    case WorkflowSourceProvider.GITHUB:
      return "github";
    case WorkflowSourceProvider.LINEAR:
      return "linear";
    case WorkflowSourceProvider.CLOUDFLARE_WORKERS_OBSERVABILITY:
      return "cloudflare_workers_observability";
    case WorkflowSourceProvider.UNSPECIFIED:
      throw new Error("workflow source provider is unspecified");
    default:
      throw new Error(`unsupported workflow source provider: ${provider}`);
  }
}

export function fromWorkflowDataSourceStatus(
  status: WorkflowDataSourceStatus
): DataSourceStatus {
  switch (status) {
    case WorkflowDataSourceStatus.ACTIVE:
      return "active";
    case WorkflowDataSourceStatus.ERROR:
      return "error";
    case WorkflowDataSourceStatus.DISCONNECTED:
      return "disconnected";
    case WorkflowDataSourceStatus.UNSPECIFIED:
      throw new Error("workflow data source status is unspecified");
    default:
      throw new Error(`unsupported workflow data source status: ${status}`);
  }
}
