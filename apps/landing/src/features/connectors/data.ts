import { listPublicSourceProviders } from "@onequery/db/source-providers";
import type { PublicSourceProvider } from "@onequery/db/source-providers";

import { ONEQUERY } from "@/shared/seo/constants";

export type ConnectorAvailability = "Dashboard + CLI" | "CLI";

export type ConnectorCapability = "API" | "Query" | "Connector" | "Workflow";

export type ConnectorInterface = "api" | "query";

export type DataSourceConnector = {
  availability: ConnectorAvailability;
  capabilities: ReadonlyArray<ConnectorCapability>;
  category: string;
  credentialType: string;
  description: string;
  guideSteps: readonly string[];
  interfaces: ReadonlyArray<ConnectorInterface>;
  key: string;
  label: string;
  slug: string;
};

export type ConnectorFaq = {
  answer: string;
  question: string;
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

function connectorSlug(label: string) {
  return label
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function sourceProviderConnector(
  provider: PublicSourceProvider
): DataSourceConnector {
  return {
    availability: sourceProviderAvailability(provider),
    capabilities: sourceProviderCapabilities(provider),
    category: provider.publicCategory,
    credentialType: provider.credentialType,
    description: provider.guideSummary,
    guideSteps: provider.guideSteps,
    interfaces: provider.interfaces,
    key: provider.id,
    label: provider.label,
    slug: connectorSlug(provider.label),
  };
}

export const DATA_SOURCE_CONNECTORS = listPublicSourceProviders().map(
  sourceProviderConnector
);

export function getConnectorPath(connector: Pick<DataSourceConnector, "slug">) {
  return `/connectors/${connector.slug}/`;
}

export function getConnectorInterfaceLabel(
  connector: Pick<DataSourceConnector, "interfaces">
) {
  const hasQuery = connector.interfaces.includes("query");
  const hasApi = connector.interfaces.includes("api");

  if (hasQuery && hasApi) {
    return "Query and API";
  }

  if (hasQuery) {
    return "Query";
  }

  return "API";
}

export function getConnectorInterfaceDescription(
  connector: Pick<DataSourceConnector, "interfaces">
) {
  const hasQuery = connector.interfaces.includes("query");
  const hasApi = connector.interfaces.includes("api");

  if (hasQuery && hasApi) {
    return "SQL-style query workflows and bounded source API calls";
  }

  if (hasQuery) {
    return "SQL-style query workflows for structured data access";
  }

  return "bounded source API calls for endpoint-specific context";
}

export function getConnectorKeywords(connector: DataSourceConnector) {
  return [
    `${connector.label} connector`,
    `${connector.label} ${ONEQUERY.NAME}`,
    `${connector.label} AI agent data access`,
    `${connector.category} connector`,
    `${ONEQUERY.NAME} connector`,
    "governed AI agent access",
    "centralized credentials",
  ].join(", ");
}

export function getConnectorMetaDescription(connector: DataSourceConnector) {
  const description = `Use the ${connector.label} connector in ${ONEQUERY.NAME} for governed AI agent access with centralized credentials, limits, and audit logs.`;

  if (description.length <= 160) {
    return description;
  }

  return `Use the ${connector.label} connector in ${ONEQUERY.NAME} for governed AI agent access with centralized credentials and audit logs.`;
}

export function getRelatedConnectors(
  connector: DataSourceConnector,
  connectors: readonly DataSourceConnector[] = DATA_SOURCE_CONNECTORS
) {
  const sameCategoryConnectors = connectors.filter(
    (candidate) =>
      candidate.key !== connector.key &&
      candidate.category === connector.category
  );

  if (sameCategoryConnectors.length >= 3) {
    return sameCategoryConnectors.slice(0, 3);
  }

  const categoryKeys = new Set(
    sameCategoryConnectors.map((candidate) => candidate.key)
  );
  const relatedByCapability = connectors.filter(
    (candidate) =>
      candidate.key !== connector.key &&
      !categoryKeys.has(candidate.key) &&
      candidate.capabilities.some((capability) =>
        connector.capabilities.includes(capability)
      )
  );

  return [...sameCategoryConnectors, ...relatedByCapability].slice(0, 3);
}

export function getConnectorFaqs(
  connector: DataSourceConnector
): ConnectorFaq[] {
  const interfaceDescription = getConnectorInterfaceDescription(connector);
  const setupSurface =
    connector.availability === "Dashboard + CLI"
      ? `the ${ONEQUERY.NAME} dashboard or CLI`
      : `the ${ONEQUERY.NAME} CLI`;
  const credentialLabel = connector.credentialType.replace(/_/gu, " ");
  const firstSetupStep = connector.guideSteps[0];

  return [
    {
      answer: `The ${ONEQUERY.NAME} ${connector.label} connector makes ${connector.category.toLowerCase()} context from ${connector.label} available to AI agents through ${interfaceDescription}. ${connector.description}`,
      question: `What is the ${ONEQUERY.NAME} ${connector.label} connector?`,
    },
    {
      answer: `Agents call ${ONEQUERY.NAME} instead of receiving raw ${connector.label} credentials. ${ONEQUERY.NAME} keeps credentials centralized, applies source boundaries, and records access in audit logs while exposing ${interfaceDescription}.`,
      question: `How do AI agents access ${connector.label} through ${ONEQUERY.NAME}?`,
    },
    {
      answer: firstSetupStep
        ? `Prepare ${credentialLabel} credentials and connect ${connector.label} from ${setupSurface}. Start with this setup step: ${firstSetupStep}`
        : `Prepare ${credentialLabel} credentials and connect ${connector.label} from ${setupSurface}.`,
      question: `How do I set up the ${connector.label} connector?`,
    },
  ];
}
