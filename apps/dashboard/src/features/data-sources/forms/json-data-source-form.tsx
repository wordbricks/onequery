import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@onequery/ui/components/input";
import { Label } from "@onequery/ui/components/label";
import { Textarea } from "@onequery/ui/components/textarea";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormFieldError } from "@/components/form-field-error";
import { FormSubmitButton } from "@/components/form-submit-button";
import { useOptimisticAdd } from "@/lib/use-optimistic-mutation";
import {
  createDataSource,
  dataSourcesQueryOptions,
} from "@/queries/data-sources-queries";
import type {
  DataSource,
  SourceProviderCatalogProvider,
} from "@/queries/data-sources-queries";

import { applyDataSourceNameConflictError } from "./data-source-errors";

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

const JsonDataSourceFormSchema = z.object({
  credentials: z.string().refine((value) => parseJsonObject(value) !== null, {
    message: "Credentials must be a valid JSON object",
  }),
  name: z.string().min(1, "Name is required"),
});

type JsonDataSourceFormData = z.infer<typeof JsonDataSourceFormSchema>;

interface JsonDataSourceFormProps {
  onSuccess: (dataSourceId: string) => void;
  organizationId: string;
  provider: SourceProviderCatalogProvider;
}

export function JsonDataSourceForm({
  organizationId,
  onSuccess,
  provider,
}: JsonDataSourceFormProps) {
  const form = useForm<JsonDataSourceFormData>({
    defaultValues: {
      name: provider.label,
      credentials: JSON.stringify(provider.credentialExample, null, 2),
    },
    resolver: zodResolver(JsonDataSourceFormSchema),
  });

  const mutation = useOptimisticAdd<
    { dataSource: { id: string } },
    JsonDataSourceFormData,
    DataSource
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      provider: provider.id,
      name: data.name,
      status: "active",
      errorMessage: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    mutationFn: async (data) => {
      const credentials = parseJsonObject(data.credentials);
      if (!credentials) {
        throw new Error("Credentials must be a valid JSON object");
      }

      return createDataSource({
        organizationId,
        provider: provider.id,
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

  const onSubmit = (data: JsonDataSourceFormData) => {
    mutation.mutate(data);
  };

  return (
    <form
      onSubmit={(event) => {
        void form.handleSubmit(onSubmit)(event);
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor={`${provider.id}-name`}>Data Source Name</Label>
        <Input
          id={`${provider.id}-name`}
          placeholder={provider.label}
          {...form.register("name")}
        />
        <FormFieldError message={form.formState.errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${provider.id}-credentials`}>Credentials JSON</Label>
        <Textarea
          id={`${provider.id}-credentials`}
          className="min-h-56 font-mono text-sm"
          spellCheck={false}
          {...form.register("credentials")}
        />
        <FormFieldError message={form.formState.errors.credentials?.message} />
      </div>

      <FormSubmitButton
        idleLabel="Create Data Source"
        isPending={mutation.isPending}
        pendingLabel="Creating..."
      />
    </form>
  );
}
