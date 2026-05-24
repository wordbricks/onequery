import { zodResolver } from "@hookform/resolvers/zod";
import type { CloudflareWorkersObservabilityCredentials } from "@onequery/db";
import { Input } from "@onequery/ui/components/input";
import { Label } from "@onequery/ui/components/label";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormFieldError } from "@/components/form-field-error";
import { FormSubmitButton } from "@/components/form-submit-button";
import { useOptimisticAdd } from "@/lib/use-optimistic-mutation";
import {
  createDataSource,
  dataSourcesQueryOptions,
} from "@/queries/data-sources-queries";
import type { DataSource } from "@/queries/data-sources-queries";

import { applyDataSourceNameConflictError } from "./data-source-errors";

const CloudflareWorkersObservabilityFormSchema = z.object({
  accountId: z.string().min(1, "Account ID is required"),
  apiBaseUrl: z.union([
    z.literal(""),
    z.url("API base URL must be a valid URL"),
  ]),
  apiToken: z.string().min(1, "API token is required"),
  name: z.string().min(1, "Name is required"),
  scriptName: z.string().optional(),
});

type CloudflareWorkersObservabilityFormData = z.infer<
  typeof CloudflareWorkersObservabilityFormSchema
>;

interface CloudflareWorkersObservabilityDataSourceFormProps {
  onSuccess: (dataSourceId: string) => void;
  organizationId: string;
}

export function CloudflareWorkersObservabilityDataSourceForm({
  onSuccess,
  organizationId,
}: CloudflareWorkersObservabilityDataSourceFormProps) {
  const form = useForm<CloudflareWorkersObservabilityFormData>({
    defaultValues: {
      accountId: "",
      apiBaseUrl: "",
      apiToken: "",
      name: "",
      scriptName: "",
    },
    resolver: zodResolver(CloudflareWorkersObservabilityFormSchema),
  });

  const mutation = useOptimisticAdd<
    { dataSource: { id: string } },
    CloudflareWorkersObservabilityFormData,
    DataSource
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      provider: "cloudflare_workers_observability",
      name: data.name,
      status: "active",
      errorMessage: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    mutationFn: async (data) => {
      const credentials = {
        type: "cloudflare_workers_observability",
        accountId: data.accountId,
        apiToken: data.apiToken,
        scriptName: data.scriptName?.trim() || undefined,
        apiBaseUrl: data.apiBaseUrl.trim() || undefined,
      } satisfies CloudflareWorkersObservabilityCredentials;

      return createDataSource({
        organizationId,
        provider: "cloudflare_workers_observability",
        name: data.name,
        credentials,
      });
    },
    onError: (error) => {
      applyDataSourceNameConflictError(error, form.setError, "name");
    },
    onSuccess: (result) => {
      onSuccess(result.dataSource.id);
    },
    queryKey: dataSourcesQueryOptions(organizationId).queryKey,
    successMessage: "Data source created successfully",
  });

  return (
    <form
      onSubmit={(event) => {
        void form.handleSubmit((data) => {
          mutation.mutate(data);
        })(event);
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="cloudflare-workers-observability-name">
          Data Source Name
        </Label>
        <Input
          id="cloudflare-workers-observability-name"
          placeholder="Cloudflare Workers"
          {...form.register("name")}
        />
        <FormFieldError message={form.formState.errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="cloudflare-workers-observability-account-id">
          Account ID
        </Label>
        <Input
          id="cloudflare-workers-observability-account-id"
          placeholder="023e105f4ecef8ad9ca31a8372d0c353"
          {...form.register("accountId")}
        />
        <FormFieldError message={form.formState.errors.accountId?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="cloudflare-workers-observability-script-name">
          Worker Script Name (optional)
        </Label>
        <Input
          id="cloudflare-workers-observability-script-name"
          placeholder="api-production"
          {...form.register("scriptName")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="cloudflare-workers-observability-api-token">
          API Token
        </Label>
        <Input
          id="cloudflare-workers-observability-api-token"
          type="password"
          placeholder="Cloudflare API token"
          {...form.register("apiToken")}
        />
        <FormFieldError message={form.formState.errors.apiToken?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="cloudflare-workers-observability-api-base-url">
          API Base URL (optional)
        </Label>
        <Input
          id="cloudflare-workers-observability-api-base-url"
          placeholder="https://api.cloudflare.com/client/v4"
          {...form.register("apiBaseUrl")}
        />
        <FormFieldError message={form.formState.errors.apiBaseUrl?.message} />
      </div>

      <FormSubmitButton
        idleLabel="Create Data Source"
        isPending={mutation.isPending}
        pendingLabel="Creating..."
      />
    </form>
  );
}
