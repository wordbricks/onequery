import { listPublicSourceProviders } from "@onequery/db/source-providers";
import type { PublicSourceProvider } from "@onequery/db/source-providers";

export type ConnectorAvailability = "Dashboard + CLI" | "CLI";

export type ConnectorCapability = "API" | "Query" | "Connector" | "Workflow";

export type DataSourceConnector = {
  availability: ConnectorAvailability;
  capabilities: ReadonlyArray<ConnectorCapability>;
  category: string;
  description: string;
  key: string;
  label: string;
};

function sourceProviderAvailability(
  provider: PublicSourceProvider
): ConnectorAvailability {
  return provider.dashboardConnectable ? "Dashboard + CLI" : "CLI";
}

function sourceProviderCapabilities(
  provider: PublicSourceProvider
): ConnectorCapability[] {
  const capabilities: ConnectorCapability[] = provider.interfaces.map(
    (sourceInterface) => (sourceInterface === "query" ? "Query" : "API")
  );

  if (provider.id.endsWith("_connector")) {
    capabilities.unshift("Connector");
  }

  if (provider.id === "linear") {
    capabilities.push("Workflow");
  }

  return capabilities;
}

function sourceProviderConnector(
  provider: PublicSourceProvider
): DataSourceConnector {
  return {
    availability: sourceProviderAvailability(provider),
    capabilities: sourceProviderCapabilities(provider),
    category: provider.publicCategory,
    description: provider.guideSummary,
    key: provider.id,
    label: provider.label,
  };
}

export const DATA_SOURCE_CONNECTORS = listPublicSourceProviders().map(
  sourceProviderConnector
);
