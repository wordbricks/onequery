import { zodResolver } from "@hookform/resolvers/zod";
import type { SentryCredentials } from "@onequery/db";
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

const SentryFormSchema = z.object({
  apiBaseUrl: z.union([
    z.literal(""),
    z.url("API base URL must be a valid URL"),
  ]),
  authToken: z.string().min(1, "Auth token is required"),
  name: z.string().min(1, "Name is required"),
  organizationSlug: z.string().min(1, "Organization slug is required"),
  projectSlug: z.string().optional(),
});

type SentryFormData = z.infer<typeof SentryFormSchema>;

interface SentryDataSourceFormProps {
  onSuccess: (dataSourceId: string) => void;
  organizationId: string;
}

export function SentryDataSourceForm({
  onSuccess,
  organizationId,
}: SentryDataSourceFormProps) {
  const form = useForm<SentryFormData>({
    defaultValues: {
      name: "",
      authToken: "",
      organizationSlug: "",
      projectSlug: "",
      apiBaseUrl: "",
    },
    resolver: zodResolver(SentryFormSchema),
  });

  const mutation = useOptimisticAdd<
    { dataSource: { id: string } },
    SentryFormData,
    DataSource
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      provider: "sentry",
      name: data.name,
      status: "active",
      useAsDataSource: true,
      errorMessage: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    mutationFn: async (data) => {
      const credentials = {
        type: "sentry",
        authToken: data.authToken,
        organizationSlug: data.organizationSlug,
        projectSlug: data.projectSlug?.trim() || undefined,
        apiBaseUrl: data.apiBaseUrl.trim() || undefined,
      } satisfies SentryCredentials;

      return createDataSource({
        organizationId,
        provider: "sentry",
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
      onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="sentry-name">Data Source Name</Label>
        <Input
          id="sentry-name"
          placeholder="My Sentry"
          {...form.register("name")}
        />
        <FormFieldError message={form.formState.errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sentry-organizationSlug">Organization Slug</Label>
        <Input
          id="sentry-organizationSlug"
          placeholder="acme"
          {...form.register("organizationSlug")}
        />
        <FormFieldError
          message={form.formState.errors.organizationSlug?.message}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sentry-projectSlug">Project Slug (optional)</Label>
        <Input
          id="sentry-projectSlug"
          placeholder="frontend"
          {...form.register("projectSlug")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sentry-authToken">Auth Token</Label>
        <Input
          id="sentry-authToken"
          type="password"
          placeholder="sntrys_..."
          {...form.register("authToken")}
        />
        <FormFieldError message={form.formState.errors.authToken?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sentry-apiBaseUrl">API Base URL (optional)</Label>
        <Input
          id="sentry-apiBaseUrl"
          placeholder="https://sentry.io/api/0"
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
