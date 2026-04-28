import type { DataSourceStatus, ProviderType } from "@onequery/db/server";

import type { CliQuerySuccessResult } from "../../domain/workflows";
import type { WorkflowCommandEnvelope } from "../kernel";
import type { QueryActionSourceDescriptor } from "./descriptors";

export type QueryActionCommandPayload =
  | {
      type: "start_validate";
      queryText: string;
      sourceKey: string;
    }
  | {
      type: "start_execute";
      queryText: string;
      sourceKey: string;
    }
  | {
      type: "record_source_lookup";
      kind: "found";
      source: QueryActionSourceDescriptor;
    }
  | {
      type: "record_source_lookup";
      kind: "not_found";
      sourceKey: string;
    }
  | {
      type: "record_source_lookup";
      kind: "query_interface_missing";
      provider: ProviderType;
      sourceStatus: DataSourceStatus;
    }
  | {
      type: "record_query_validation";
      detail?: never;
      hint?: never;
      kind: "accepted";
      truncated: boolean;
      validatedQuery: string;
    }
  | {
      type: "record_query_validation";
      detail: string;
      kind: "rejected";
    }
  | {
      type: "record_query_validation";
      detail: string;
      hint: string;
      kind: "preparation_failed";
    }
  | {
      type: "record_credentials_load";
      kind: "loaded";
    }
  | {
      type: "record_credentials_load";
      detail: string;
      hint: string;
      kind: "preparation_failed";
    }
  | {
      type: "record_query_execution";
      kind: "succeeded";
      response: CliQuerySuccessResult;
    }
  | {
      type: "record_query_execution";
      detail: string;
      kind: "unavailable";
    }
  | {
      type: "record_query_execution";
      detail: string;
      kind: "timed_out";
    }
  | {
      type: "record_query_execution";
      detail: string;
      kind: "failed";
    }
  | {
      type: "record_usage_persistence";
      kind: "succeeded";
    }
  | {
      type: "record_usage_persistence";
      detail: string;
      kind: "failed";
    };

export type QueryActionCommand = WorkflowCommandEnvelope<
  "query_action",
  QueryActionCommandPayload
>;
