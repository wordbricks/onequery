import type { ComponentType } from "react";

import { getProviderIcon } from "@/components/provider-icons";
import type { SourceProviderCatalogProvider } from "@/queries/data-sources-queries";

type ProviderIcon = ComponentType<{
  className?: string;
  size?: number | string;
}>;

export type ProviderType = string;

export type ConnectableDataSourceOption = SourceProviderCatalogProvider & {
  icon: ProviderIcon;
  value: string;
};

export const DEFAULT_CONNECTABLE_PROVIDER = "postgres";

export function getConnectableDataSourceOptions(
  providers: readonly SourceProviderCatalogProvider[]
): ConnectableDataSourceOption[] {
  return providers
    .filter((provider) => provider.dashboardConnectable)
    .map((provider) => ({
      ...provider,
      icon: getProviderIcon(provider.id),
      value: provider.id,
    }));
}

export function isProviderType(
  value: string,
  providers: readonly SourceProviderCatalogProvider[]
): value is ProviderType {
  return providers.some(
    (provider) => provider.dashboardConnectable && provider.id === value
  );
}

export function isTestableDataSourceProvider(
  provider: string,
  providers: readonly SourceProviderCatalogProvider[]
): boolean {
  return providers.some(
    (candidate) => candidate.id === provider && candidate.testable
  );
}

export function getDataSourceProviderLabel(
  provider: string,
  providers: readonly SourceProviderCatalogProvider[]
): string {
  return (
    providers.find((candidate) => candidate.id === provider)?.label ?? provider
  );
}
