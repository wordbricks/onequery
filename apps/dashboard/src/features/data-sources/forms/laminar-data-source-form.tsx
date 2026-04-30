import { zodResolver } from "@hookform/resolvers/zod";
import type { LaminarCredentials } from "@onequery/db";
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

const OptionalUrlSchema = z.union([
  z.url("API Base URL must be a valid URL"),
  z.literal(""),
]);

const LaminarFormSchema = z.object({
  apiBaseUrl: OptionalUrlSchema,
  apiKey: z.string().min(1, "API Key is required"),
  name: z.string().min(1, "Name is required"),
});

type LaminarFormData = z.infer<typeof LaminarFormSchema>;

interface LaminarDataSourceFormProps {
  onSuccess: (dataSourceId: string) => void;
  organizationId: string;
}

export function LaminarDataSourceForm({
  organizationId,
  onSuccess,
}: LaminarDataSourceFormProps) {
  const form = useForm<LaminarFormData>({
    defaultValues: {
      name: "",
      apiKey: "",
      apiBaseUrl: "",
    },
    resolver: zodResolver(LaminarFormSchema),
  });

  const mutation = useOptimisticAdd<
    { dataSource: { id: string } },
    LaminarFormData,
    DataSource
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      provider: "laminar",
      name: data.name,
      status: "active",
      useAsDataSource: true,
      errorMessage: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    mutationFn: async (data) => {
      const credentials: LaminarCredentials = {
        type: "laminar",
        apiKey: data.apiKey.trim(),
      };
      const trimmedBaseUrl = data.apiBaseUrl.trim();
      if (trimmedBaseUrl) {
        credentials.apiBaseUrl = trimmedBaseUrl;
      }
      return createDataSource({
        organizationId,
        provider: "laminar",
        name: data.name.trim(),
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

  const onSubmit = (data: LaminarFormData) => {
    mutation.mutate(data);
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="laminar-name">Data Source Name</Label>
        <Input
          id="laminar-name"
          placeholder="Laminar"
          {...form.register("name")}
        />
        <FormFieldError message={form.formState.errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="laminar-api-key">API Key</Label>
        <Input
          id="laminar-api-key"
          type="password"
          placeholder="lmnr_project_key_..."
          {...form.register("apiKey")}
        />
        <FormFieldError message={form.formState.errors.apiKey?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="laminar-api-base-url">API Base URL (optional)</Label>
        <Input
          id="laminar-api-base-url"
          placeholder="https://api.lmnr.ai"
          {...form.register("apiBaseUrl")}
        />
        <FormFieldError message={form.formState.errors.apiBaseUrl?.message} />
        <p className="text-xs text-muted-foreground">
          Leave blank to use the default Laminar endpoint.
        </p>
      </div>

      <FormSubmitButton
        idleLabel="Create Data Source"
        isPending={mutation.isPending}
        pendingLabel="Creating..."
      />
    </form>
  );
}
