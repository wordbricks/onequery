import type { QueryActionSourceDescriptor } from "./descriptors";

export type QueryActionEffect =
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
      type: "execute_query";
      validatedQuery: string;
    }
  | {
      sourceId: string;
      type: "persist_usage";
    };
