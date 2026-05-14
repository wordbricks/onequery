import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { DataSourceConnectionGuideDialog } from "@/features/data-sources/data-source-connection-guide-dialog";
import {
  DEFAULT_CONNECTABLE_PROVIDER,
  getConnectableDataSourceOptions,
  isProviderType,
} from "@/features/data-sources/data-source-provider-metadata";
import type {
  ConnectableDataSourceOption,
  ProviderType,
} from "@/features/data-sources/data-source-provider-metadata";
import { AmplitudeDataSourceForm } from "@/features/data-sources/forms/amplitude-data-source-form";
import { CloudflareWorkersObservabilityDataSourceForm } from "@/features/data-sources/forms/cloudflare-workers-observability-data-source-form";
import { ConnectorDataSourceForm } from "@/features/data-sources/forms/connector-data-source-form";
import { CredentialDataSourceForm } from "@/features/data-sources/forms/credential-data-source-form";
import { DatabaseDataSourceForm } from "@/features/data-sources/forms/database-data-source-form";
import { isDatabaseProvider } from "@/features/data-sources/forms/database-provider-defaults";
import { GitHubDataSourceForm } from "@/features/data-sources/forms/github-data-source-form";
import { JsonDataSourceForm } from "@/features/data-sources/forms/json-data-source-form";
import { LaminarDataSourceForm } from "@/features/data-sources/forms/laminar-data-source-form";
import { MixpanelDataSourceForm } from "@/features/data-sources/forms/mixpanel-data-source-form";
import { MongoDBDataSourceForm } from "@/features/data-sources/forms/mongodb-data-source-form";
import { PostHogDataSourceForm } from "@/features/data-sources/forms/posthog-data-source-form";
import { SentryDataSourceForm } from "@/features/data-sources/forms/sentry-data-source-form";
import { sourceProvidersQueryOptions } from "@/queries/data-sources-queries";
import { Label } from "@/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";

interface DataSourceConnectionFormProps {
  // Comment: callers must provide the concrete org up front. Inferring from
  // Better Auth session state is ambiguous for multi-org flows.
  organizationId: string;
  onSuccess: (dataSourceId: string) => void;
  className?: string;
  initialProvider?: ProviderType;
}

function resolveSelectedProvider(input: {
  initialProvider?: string;
  requestedProvider: string | null;
  providerIds: readonly string[];
}): string {
  if (
    input.requestedProvider &&
    input.providerIds.includes(input.requestedProvider)
  ) {
    return input.requestedProvider;
  }

  if (
    input.initialProvider &&
    input.providerIds.includes(input.initialProvider)
  ) {
    return input.initialProvider;
  }

  if (input.providerIds.includes(DEFAULT_CONNECTABLE_PROVIDER)) {
    return DEFAULT_CONNECTABLE_PROVIDER;
  }

  return input.providerIds[0] ?? "";
}

type GoogleServiceAccountProvider = "ga" | "bigquery";

function isGoogleServiceAccountProvider(
  provider: string
): provider is GoogleServiceAccountProvider {
  return provider === "ga" || provider === "bigquery";
}

function renderConnectionForm(input: {
  organizationId: string;
  onSuccess: (dataSourceId: string) => void;
  provider: ConnectableDataSourceOption;
}) {
  const { organizationId, onSuccess, provider } = input;
  const providerId = provider.id;
  const commonProps = {
    organizationId,
    onSuccess,
  };

  switch (provider.dashboardCredentialForm) {
    case "database":
      if (isDatabaseProvider(providerId)) {
        return (
          <DatabaseDataSourceForm
            key={providerId}
            {...commonProps}
            provider={providerId}
          />
        );
      }
      break;
    case "mongodb":
      return <MongoDBDataSourceForm key={providerId} {...commonProps} />;
    case "google_service_account":
      if (isGoogleServiceAccountProvider(providerId)) {
        return (
          <CredentialDataSourceForm
            key={providerId}
            {...commonProps}
            provider={providerId}
          />
        );
      }
      break;
    case "amplitude":
      return <AmplitudeDataSourceForm key={providerId} {...commonProps} />;
    case "laminar":
      return <LaminarDataSourceForm key={providerId} {...commonProps} />;
    case "cloudflare_workers_observability":
      return (
        <CloudflareWorkersObservabilityDataSourceForm
          key={providerId}
          {...commonProps}
        />
      );
    case "aws_athena_connector":
      return <ConnectorDataSourceForm key={providerId} {...commonProps} />;
    case "mixpanel":
      return <MixpanelDataSourceForm key={providerId} {...commonProps} />;
    case "sentry":
      return <SentryDataSourceForm key={providerId} {...commonProps} />;
    case "posthog":
      return <PostHogDataSourceForm key={providerId} {...commonProps} />;
    case "github":
      return <GitHubDataSourceForm key={providerId} {...commonProps} />;
  }

  return (
    <JsonDataSourceForm
      key={providerId}
      provider={provider}
      organizationId={organizationId}
      onSuccess={onSuccess}
    />
  );
}

export function DataSourceConnectionForm(props: DataSourceConnectionFormProps) {
  const [requestedProvider, setRequestedProvider] = useState<string | null>(
    null
  );
  const providersQuery = useQuery(sourceProvidersQueryOptions());
  const providers = providersQuery.data?.providers ?? [];
  const providerOptions = getConnectableDataSourceOptions(providers);
  const selectedProvider = resolveSelectedProvider({
    initialProvider: props.initialProvider,
    requestedProvider,
    providerIds: providerOptions.map((provider) => provider.id),
  });
  const selectedProviderDefinition = providerOptions.find(
    (provider) => provider.id === selectedProvider
  );

  const handleProviderChange = (value: string | null) => {
    if (!value) {
      return;
    }
    if (isProviderType(value, providers)) {
      setRequestedProvider(value);
    }
  };

  const containerClassName = props.className
    ? `space-y-4 ${props.className}`
    : "space-y-4";

  if (providersQuery.isPending) {
    return (
      <div className={containerClassName}>
        <p className="text-sm text-muted-foreground">
          Loading source providers...
        </p>
      </div>
    );
  }

  if (providersQuery.isError) {
    return (
      <div className={containerClassName}>
        <p className="text-sm text-destructive">
          {providersQuery.error.message}
        </p>
      </div>
    );
  }

  if (!selectedProviderDefinition) {
    return (
      <div className={containerClassName}>
        <p className="text-sm text-muted-foreground">
          No connectable source providers are available.
        </p>
      </div>
    );
  }

  return (
    <div className={containerClassName}>
      <div className="space-y-2">
        <Label htmlFor="type">Type</Label>
        <Select
          items={[...providerOptions]}
          value={selectedProvider}
          onValueChange={handleProviderChange}
        >
          <SelectTrigger id="type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providerOptions.map((provider) => (
              <SelectItem key={provider.value} value={provider.value}>
                <div className="flex items-center gap-2">
                  <provider.icon className="h-4 w-4" />
                  <span>{provider.label}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DataSourceConnectionGuideDialog provider={selectedProviderDefinition} />

      {renderConnectionForm({
        provider: selectedProviderDefinition,
        organizationId: props.organizationId,
        onSuccess: props.onSuccess,
      })}
    </div>
  );
}
