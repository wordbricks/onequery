import type {
  SourceApiActionRequestDescriptor,
  SourceApiActionSourceDescriptor,
} from "./descriptors";

export type SourceApiActionEffect =
  | {
      organizationId: string;
      sourceKey: string;
      type: "load_source";
    }
  | {
      source: SourceApiActionSourceDescriptor;
      type: "resolve_descriptor";
    }
  | {
      requestDescriptor: SourceApiActionRequestDescriptor;
      source: SourceApiActionSourceDescriptor;
      type: "prepare_request";
    }
  | {
      attemptNumber: number;
      pageIndex: number;
      preparedRequestFingerprint: string;
      requestDescriptor: SourceApiActionRequestDescriptor;
      source: SourceApiActionSourceDescriptor;
      type: "execute_page";
    };
