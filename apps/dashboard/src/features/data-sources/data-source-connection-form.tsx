import { useEffect, useState } from "react";

import { DataSourceConnectionGuideDialog } from "@/features/data-sources/data-source-connection-guide-dialog";
import {
  CONNECTABLE_DATA_SOURCE_OPTIONS,
  DEFAULT_CONNECTABLE_PROVIDER,
  isProviderType,
} from "@/features/data-sources/data-source-provider-metadata";
import type { ProviderType } from "@/features/data-sources/data-source-provider-metadata";
import { AmplitudeDataSourceForm } from "@/features/data-sources/forms/amplitude-data-source-form";
import { CloudflareWorkersObservabilityDataSourceForm } from "@/features/data-sources/forms/cloudflare-workers-observability-data-source-form";
import { ConnectorDataSourceForm } from "@/features/data-sources/forms/connector-data-source-form";
import { CredentialDataSourceForm } from "@/features/data-sources/forms/credential-data-source-form";
import { DatabaseDataSourceForm } from "@/features/data-sources/forms/database-data-source-form";
import { isDatabaseProvider } from "@/features/data-sources/forms/database-provider-defaults";
import { GitHubDataSourceForm } from "@/features/data-sources/forms/github-data-source-form";
import { LaminarDataSourceForm } from "@/features/data-sources/forms/laminar-data-source-form";
import { MixpanelDataSourceForm } from "@/features/data-sources/forms/mixpanel-data-source-form";
import { MongoDBDataSourceForm } from "@/features/data-sources/forms/mongodb-data-source-form";
import { PostHogDataSourceForm } from "@/features/data-sources/forms/posthog-data-source-form";
import { SentryDataSourceForm } from "@/features/data-sources/forms/sentry-data-source-form";
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

export function DataSourceConnectionForm(props: DataSourceConnectionFormProps) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderType>(
    props.initialProvider ?? DEFAULT_CONNECTABLE_PROVIDER
  );

  useEffect(() => {
    if (!props.initialProvider) {
      return;
    }
    if (props.initialProvider === selectedProvider) {
      return;
    }
    setSelectedProvider(props.initialProvider);
  }, [props.initialProvider, selectedProvider]);

  const handleProviderChange = (value: string | null) => {
    if (!value) {
      return;
    }
    if (isProviderType(value)) {
      setSelectedProvider(value);
    }
  };

  const containerClassName = props.className
    ? `space-y-4 ${props.className}`
    : "space-y-4";

  return (
    <div className={containerClassName}>
      <div className="space-y-2">
        <Label htmlFor="type">Type</Label>
        <Select
          items={[...CONNECTABLE_DATA_SOURCE_OPTIONS]}
          value={selectedProvider}
          onValueChange={handleProviderChange}
        >
          <SelectTrigger id="type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONNECTABLE_DATA_SOURCE_OPTIONS.map((provider) => (
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
      <DataSourceConnectionGuideDialog provider={selectedProvider} />

      {isDatabaseProvider(selectedProvider) && (
        <DatabaseDataSourceForm
          provider={selectedProvider}
          organizationId={props.organizationId}
          onSuccess={props.onSuccess}
        />
      )}

      {selectedProvider === "mongodb" && (
        <MongoDBDataSourceForm
          organizationId={props.organizationId}
          onSuccess={props.onSuccess}
        />
      )}

      {(selectedProvider === "ga" || selectedProvider === "bigquery") && (
        <CredentialDataSourceForm
          provider={selectedProvider}
          organizationId={props.organizationId}
          onSuccess={props.onSuccess}
        />
      )}

      {selectedProvider === "amplitude" && (
        <AmplitudeDataSourceForm
          organizationId={props.organizationId}
          onSuccess={props.onSuccess}
        />
      )}

      {selectedProvider === "laminar" && (
        <LaminarDataSourceForm
          organizationId={props.organizationId}
          onSuccess={props.onSuccess}
        />
      )}

      {selectedProvider === "cloudflare_workers_observability" && (
        <CloudflareWorkersObservabilityDataSourceForm
          organizationId={props.organizationId}
          onSuccess={props.onSuccess}
        />
      )}

      {selectedProvider === "aws_athena_connector" && (
        <ConnectorDataSourceForm
          organizationId={props.organizationId}
          onSuccess={props.onSuccess}
        />
      )}

      {selectedProvider === "mixpanel" && (
        <MixpanelDataSourceForm
          organizationId={props.organizationId}
          onSuccess={props.onSuccess}
        />
      )}

      {selectedProvider === "sentry" && (
        <SentryDataSourceForm
          organizationId={props.organizationId}
          onSuccess={props.onSuccess}
        />
      )}

      {selectedProvider === "posthog" && (
        <PostHogDataSourceForm
          organizationId={props.organizationId}
          onSuccess={props.onSuccess}
        />
      )}

      {selectedProvider === "github" && (
        <GitHubDataSourceForm
          organizationId={props.organizationId}
          onSuccess={props.onSuccess}
        />
      )}
    </div>
  );
}
