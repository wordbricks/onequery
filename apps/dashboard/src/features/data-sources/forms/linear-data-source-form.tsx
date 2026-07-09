import { zodResolver } from "@hookform/resolvers/zod";
import { LinearAccessModeSchema } from "@onequery/db/credentials";
import type { LinearApiKeyCredentials } from "@onequery/db/credentials";
import { Input } from "@onequery/ui/components/input";
import { Label } from "@onequery/ui/components/label";
import { LinearAccessModeSelector } from "@onequery/ui/data-sources/linear-access-mode";
import type { LinearAccessMode } from "@onequery/ui/data-sources/linear-access-mode";
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

const LinearDataSourceFormSchema = z.object({
  accessMode: LinearAccessModeSchema,
  apiKey: z.string().min(1, "API key is required"),
  name: z.string().min(1, "Name is required"),
});

type LinearDataSourceFormData = z.infer<typeof LinearDataSourceFormSchema>;

interface LinearDataSourceFormProps {
  onSuccess: (dataSourceId: string) => void;
  organizationId: string;
}

export function LinearDataSourceForm({
  onSuccess,
  organizationId,
}: LinearDataSourceFormProps) {
  const form = useForm<LinearDataSourceFormData>({
    defaultValues: {
      accessMode: "mention",
      apiKey: "",
      name: "Linear",
    },
    resolver: zodResolver(LinearDataSourceFormSchema),
  });
  const accessMode = form.watch("accessMode");

  const mutation = useOptimisticAdd<
    { dataSource: { id: string } },
    LinearDataSourceFormData,
    DataSource
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      provider: "linear",
      name: data.name,
      status: "active",
      errorMessage: null,
      linearAccessMode: data.accessMode,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    mutationFn: async (data) => {
      const credentials = {
        type: "linear",
        apiKey: data.apiKey,
        accessMode: data.accessMode,
      } satisfies LinearApiKeyCredentials;

      return createDataSource({
        organizationId,
        provider: "linear",
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
    successMessage: "Linear connected",
  });

  function handleAccessModeChange(value: LinearAccessMode) {
    form.setValue("accessMode", value, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  }

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
        <Label htmlFor="linear-name">Data Source Name</Label>
        <Input
          id="linear-name"
          placeholder="Linear"
          {...form.register("name")}
        />
        <FormFieldError message={form.formState.errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="linear-api-key">API Key</Label>
        <Input
          id="linear-api-key"
          type="password"
          placeholder="lin_api_..."
          {...form.register("apiKey")}
        />
        <FormFieldError message={form.formState.errors.apiKey?.message} />
      </div>

      <div className="space-y-2">
        <Label id="linear-access-mode-label">Access Mode</Label>
        <LinearAccessModeSelector
          ariaLabelledBy="linear-access-mode-label"
          disabled={mutation.isPending}
          value={accessMode}
          onChange={handleAccessModeChange}
        />
        <FormFieldError message={form.formState.errors.accessMode?.message} />
      </div>

      <FormSubmitButton
        idleLabel="Connect Linear"
        isPending={mutation.isPending}
        pendingLabel="Connecting..."
      />
    </form>
  );
}
