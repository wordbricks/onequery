import type { DataSourceStatus, ProviderType } from "@onequery/db/server";

import type { WorkflowCommittedEvent } from "../kernel";
import type {
  QueryActionMode,
  QueryActionSourceDescriptor,
} from "./descriptors";

export type QueryActionEvent =
  | {
      queryMode: QueryActionMode;
      queryText: string;
      type: "action_received";
    }
  | {
      source: QueryActionSourceDescriptor;
      type: "source_loaded";
    }
  | {
      sourceKey: string;
      type: "source_not_found";
    }
  | {
      provider: ProviderType;
      sourceStatus: DataSourceStatus;
      type: "source_query_interface_missing";
    }
  | {
      type: "query_validated";
      validatedQuery: string;
    }
  | {
      detail: string;
      type: "query_rejected";
    }
  | {
      type: "credentials_loaded";
    }
  | {
      detail: string;
      hint: string;
      type: "query_preparation_failed";
    }
  | {
      elapsedMs: number;
      rowCount: number;
      type: "query_executed";
    }
  | {
      detail: string;
      type: "query_unavailable";
    }
  | {
      detail: string;
      type: "query_timed_out";
    }
  | {
      detail: string;
      type: "query_execution_failed";
    }
  | {
      type: "usage_persisted";
    }
  | {
      detail: string;
      type: "usage_persist_failed";
    };

export type QueryActionCommittedEvent =
  WorkflowCommittedEvent<QueryActionEvent>;
