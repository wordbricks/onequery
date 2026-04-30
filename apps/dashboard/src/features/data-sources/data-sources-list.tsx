import { formatDate } from "@onequery/datetime/format-date";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@onequery/ui/components/alert";
import { Badge } from "@onequery/ui/components/badge";
import { Button } from "@onequery/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@onequery/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@onequery/ui/components/dropdown-menu";
import {
  IconAlertTriangle,
  IconDotsVertical,
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { GitHubIcon, getProviderIcon } from "@/components/provider-icons";
import { AddDataSourceDialog } from "@/features/data-sources/add-data-source-dialog";
import { showDataSourceErrorToast } from "@/features/data-sources/data-source-error-toast";
import {
  CONNECTABLE_DATA_SOURCE_PROVIDERS,
  getDataSourceProviderLabel,
  isTestableDataSourceProvider,
} from "@/features/data-sources/data-source-provider-metadata";
import type { ProviderType } from "@/features/data-sources/data-source-provider-metadata";
import { GitHubRepositoriesDialog } from "@/features/data-sources/github-repositories-dialog";
import { useOptimisticDelete } from "@/lib/use-optimistic-mutation";
import {
  dataSourcesQueryOptions,
  deleteDataSource,
  testDataSource,
} from "@/queries/data-sources-queries";
import type { DataSource } from "@/queries/data-sources-queries";

function getStatusVariant(
  status: DataSource["status"]
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active": {
      return "default";
    }
    case "error": {
      return "destructive";
    }
    case "disconnected": {
      return "secondary";
    }
    default: {
      return "outline";
    }
  }
}

function DataSourceErrorAlert(props: { errorMessage: string | null }) {
  if (!props.errorMessage) {
    return null;
  }

  return (
    <Alert
      variant="destructive"
      className="mt-3 border-destructive/30 bg-destructive/5"
    >
      <IconAlertTriangle className="size-4" />
      <AlertTitle>Connection needs attention</AlertTitle>
      <AlertDescription className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words pr-1">
        {props.errorMessage}
      </AlertDescription>
    </Alert>
  );
}

function DataSourceCard({
  dataSource,
  organizationId,
  openGitHubRepositories,
}: {
  dataSource: DataSource;
  organizationId: string;
  openGitHubRepositories?: boolean;
}) {
  const queryKey = dataSourcesQueryOptions(organizationId).queryKey;
  const [repoDialogOpen, setRepoDialogOpen] = useState(false);
  const autoOpenHandled = useRef(false);

  useEffect(() => {
    if (autoOpenHandled.current) {
      return;
    }
    if (!openGitHubRepositories) {
      return;
    }
    if (dataSource.provider !== "github") {
      return;
    }
    setRepoDialogOpen(true);
    autoOpenHandled.current = true;
  }, [dataSource.provider, openGitHubRepositories]);

  const testMutation = useMutation({
    mutationFn: async () => testDataSource(dataSource.id, organizationId),
    mutationKey: ["data-sources"],
    onError: (error: Error) =>
      showDataSourceErrorToast({
        title: "Failed to test data source",
        description: error.message,
      }),
    onSuccess: (result) => {
      if (result.kind === "unsupported") {
        toast.info(result.message);
        return;
      }
      if (result.result.success) {
        toast.success("Data source test successful");
        return;
      }
      const errorMessage =
        result.result.error ?? result.result.message ?? "Unknown error";
      showDataSourceErrorToast({
        title: "Data source test failed",
        description: errorMessage,
      });
    },
  });

  const deleteMutation = useOptimisticDelete<void, DataSource>({
    errorMessage: "Failed to delete data source",
    itemId: dataSource.id,
    mutationFn: async () => deleteDataSource(dataSource.id, organizationId),
    queryKey,
    successMessage: "Data source deleted",
  });

  const Icon = getProviderIcon(dataSource.provider);
  const isTestable = isTestableDataSourceProvider(dataSource.provider);
  const testLabel = isTestable
    ? "Test Connection"
    : "Test Connection (Unsupported)";

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-lg">{dataSource.name}</CardTitle>
          <CardDescription className="flex items-center gap-1.5 mt-0.5">
            <Icon className="h-4.5 w-4.5" />
            {getDataSourceProviderLabel(dataSource.provider)}
          </CardDescription>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button variant="ghost" size="icon-sm">
              <IconDotsVertical size={16} stroke={2} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || !isTestable}
            >
              <IconRefresh size={16} stroke={2} />
              {testMutation.isPending ? "Testing..." : testLabel}
            </DropdownMenuItem>
            {dataSource.provider === "github" ? (
              <DropdownMenuItem onClick={() => setRepoDialogOpen(true)}>
                <GitHubIcon size={16} stroke="2" />
                Select Repositories
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="text-destructive focus:text-destructive"
            >
              <IconTrash size={16} stroke={2} />
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <Badge variant={getStatusVariant(dataSource.status)}>
            {dataSource.status}
          </Badge>
        </div>
        {dataSource.lastUsedAt && (
          <p className="text-sm text-muted-foreground mt-2">
            Last used: {formatDate(dataSource.lastUsedAt)}
          </p>
        )}
        <DataSourceErrorAlert errorMessage={dataSource.errorMessage} />
      </CardContent>
      {dataSource.provider === "github" ? (
        <GitHubRepositoriesDialog
          organizationId={organizationId}
          dataSourceId={dataSource.id}
          open={repoDialogOpen}
          onOpenChange={setRepoDialogOpen}
        />
      ) : null}
    </Card>
  );
}

interface DataSourcesListProps {
  organizationId: string;
  openGitHubDataSourceId?: string | null;
}

function getVisibleConnectedDataSources(
  dataSources: DataSource[]
): DataSource[] {
  return dataSources;
}

function NotConnectedDataSourceCard(props: {
  provider: ProviderType;
  organizationId: string;
}) {
  const Icon = getProviderIcon(props.provider);

  return (
    <Card className="border-dashed">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
            <p className="font-medium truncate">
              {getDataSourceProviderLabel(props.provider)}
            </p>
          </div>
          <AddDataSourceDialog
            organizationId={props.organizationId}
            initialProvider={props.provider}
          >
            <Button variant="secondary" size="sm">
              Connect
            </Button>
          </AddDataSourceDialog>
        </div>
      </CardContent>
    </Card>
  );
}

export function DataSourcesList({
  organizationId,
  openGitHubDataSourceId,
}: DataSourcesListProps) {
  const { data: dataSources } = useSuspenseQuery(
    dataSourcesQueryOptions(organizationId)
  );

  const visibleDataSources = getVisibleConnectedDataSources(dataSources);
  const connectedProviders = new Set(
    visibleDataSources.map((dataSource) => dataSource.provider)
  );
  const notConnectedProviders = CONNECTABLE_DATA_SOURCE_PROVIDERS.filter(
    (provider) => !connectedProviders.has(provider)
  );
  const hasConnectedDataSources = visibleDataSources.length > 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Connected</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Data sources already connected to your workspace.
          </p>
        </div>
        <AddDataSourceDialog organizationId={organizationId}>
          <Button>
            <IconPlus size={16} stroke={2} />
            Add Data Source
          </Button>
        </AddDataSourceDialog>
      </div>

      {!hasConnectedDataSources ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            No connected data sources yet.
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Connect one below or add a new data source to get started.
          </p>
        </div>
      ) : null}

      {hasConnectedDataSources ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {visibleDataSources.map((dataSource) => (
            <DataSourceCard
              key={dataSource.id}
              dataSource={dataSource}
              organizationId={organizationId}
              openGitHubRepositories={openGitHubDataSourceId === dataSource.id}
            />
          ))}
        </div>
      ) : null}

      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Not connected</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Available data sources you can connect next.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {notConnectedProviders.map((provider) => (
            <NotConnectedDataSourceCard
              key={provider}
              provider={provider}
              organizationId={organizationId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
