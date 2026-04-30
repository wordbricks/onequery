import type { DataSourceStatus, ProviderType } from "@onequery/db";
import { queryOptions } from "@tanstack/react-query";
import type { InferRequestType } from "hono/client";

import { createApiClient } from "@/lib/api-client";
import {
  createApiError,
  getApiErrorMessage,
  parseApiErrorPayload,
} from "@/queries/api-error";

export interface DataSource {
  id: string;
  provider: ProviderType;
  name: string;
  status: DataSourceStatus;
  useAsDataSource: boolean;
  errorMessage: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type ConnectionTestResult = {
  success: boolean;
  message: string;
  error?: string;
  latencyMs?: number;
};

type DataSourceTestResult =
  | { kind: "supported"; result: ConnectionTestResult }
  | {
      kind: "unsupported";
      reason: "oauth" | "not_implemented";
      message: string;
    };

const client = createApiClient();

type CreateDataSourceRequest = NonNullable<
  InferRequestType<(typeof client.api)["data-sources"]["$post"]>["json"]
>;

async function fetchDataSources(organizationId: string): Promise<DataSource[]> {
  const response = await client.api["data-sources"].$get({
    query: { organizationId },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(error, "Failed to fetch data sources"));
  }

  const data = await response.json();
  return data.dataSources;
}

export function dataSourcesQueryOptions(organizationId: string) {
  return queryOptions({
    queryFn: async () => fetchDataSources(organizationId),
    queryKey: ["data-sources", organizationId] as const,
  });
}

export async function testDataSource(
  dataSourceId: string,
  organizationId: string
): Promise<DataSourceTestResult> {
  const response = await client.api["data-sources"][":id"].test.$post({
    param: { id: dataSourceId },
    query: { organizationId },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(error, "Failed to test data source"));
  }

  const data = await response.json();
  return data.result;
}

export async function deleteDataSource(
  dataSourceId: string,
  organizationId: string
): Promise<void> {
  const response = await client.api["data-sources"][":id"].$delete({
    param: { id: dataSourceId },
    query: { organizationId },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(error, "Failed to delete data source"));
  }
}

export async function createDataSource(
  data: CreateDataSourceRequest
): Promise<{ dataSource: { id: string } }> {
  const response = await client.api["data-sources"].$post({
    json: data,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const payload = parseApiErrorPayload(error);
    if (payload) {
      throw createApiError(payload);
    }

    throw new Error("Failed to create data source");
  }

  const result = await response.json();
  return { dataSource: { id: result.dataSource.id } };
}
