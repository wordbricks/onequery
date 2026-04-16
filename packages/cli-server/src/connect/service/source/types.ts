import type { MessageInitShape } from "@bufbuild/protobuf";
import type {
  Credentials,
  DataSourceStatus,
  ProviderType,
} from "@onequery/db/server";

import {
  CliSourceSchema,
  ConnectSourceResponseSchema,
  GetSourceConnectGuideResponseSchema,
  GetSourceResponseSchema,
  TestSourceResponseSchema,
} from "../../gen/onequery/cli/v1/source_pb";

export type GetSourceConnectGuideResponseInit = MessageInitShape<
  typeof GetSourceConnectGuideResponseSchema
>;
export type ConnectSourceResponseInit = MessageInitShape<
  typeof ConnectSourceResponseSchema
>;
export type CliSourceInit = MessageInitShape<typeof CliSourceSchema>;
export type GetSourceResponseInit = MessageInitShape<
  typeof GetSourceResponseSchema
>;
export type TestSourceResponseInit = MessageInitShape<
  typeof TestSourceResponseSchema
>;

export type ParsedConnectSourceCredentials = {
  provider: ProviderType;
  credentials: Credentials;
};

export type BuildCliSourceInput = {
  sourceKey: string;
  displayName?: string | null;
  provider: ProviderType;
  status: DataSourceStatus;
};
