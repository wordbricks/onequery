import type { QueryActionSourceDescriptor } from "./descriptors";

export type QueryActionEffect =
  | {
      organizationId: string;
      sourceKey: string;
      type: "load_source";
    }
  | {
      queryText: string;
      source: QueryActionSourceDescriptor;
      type: "validate_query";
    }
  | {
      organizationId: string;
      queryText: string;
      sourceKey: string;
      type: "prepare_validate_query";
    }
  | {
      organizationId: string;
      queryText: string;
      sourceKey: string;
      type: "prepare_execute_query";
    }
  | {
      source: QueryActionSourceDescriptor;
      type: "load_credentials";
    }
  | {
      source: QueryActionSourceDescriptor;
      type: "execute_query";
      validatedQuery: string;
    }
  | {
      sourceId: string;
      type: "persist_usage";
    };
