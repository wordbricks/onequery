import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  Credentials,
  DataSourceStatus,
  ProviderType,
} from "@onequery/db/server";

import {
  ConnectSourceResponseSchema,
  GetSourceConnectGuideResponseSchema,
  GetSourceResponseSchema,
} from "../../gen/onequery/cli/v1/source_pb";

export type GetSourceConnectGuideResponseInit = MessageInitShape<
  typeof GetSourceConnectGuideResponseSchema
>;
export type ConnectSourceResponseInit = MessageInitShape<
  typeof ConnectSourceResponseSchema
>;
export type GetSourceResponseInit = MessageInitShape<
  typeof GetSourceResponseSchema
>;

export type ParsedConnectSourceCredentials = {
  provider: ProviderType;
  credentials: Credentials;
};

export type BuildGetSourceResponseInput = {
  sourceKey: string;
  displayName?: string | null;
  provider: ProviderType;
  status: DataSourceStatus;
};
