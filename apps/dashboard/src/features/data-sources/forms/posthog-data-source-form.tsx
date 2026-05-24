import { zodResolver } from "@hookform/resolvers/zod";
import type { PostHogCredentials } from "@onequery/db";
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

const PostHogFormSchema = z.object({
  hostUrl: z
    .string()
    .min(1, "Host URL is required")
    .pipe(z.url("Invalid host URL")),
  name: z.string().min(1, "Name is required"),
  personalApiKey: z.string().min(1, "Personal API Key is required"),
  projectId: z.string().min(1, "Project ID is required"),
});

type PostHogFormData = z.infer<typeof PostHogFormSchema>;

interface PostHogDataSourceFormProps {
  onSuccess: (dataSourceId: string) => void;
  organizationId: string;
}

export function PostHogDataSourceForm({
  onSuccess,
  organizationId,
}: PostHogDataSourceFormProps) {
  const form = useForm<PostHogFormData>({
    defaultValues: {
      name: "",
      projectId: "",
      personalApiKey: "",
      hostUrl: "https://us.posthog.com",
    },
    resolver: zodResolver(PostHogFormSchema),
  });

  const mutation = useOptimisticAdd<
    { dataSource: { id: string } },
    PostHogFormData,
    DataSource
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      provider: "posthog",
      name: data.name,
      status: "active",
      errorMessage: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    mutationFn: async (data) => {
      const credentials = {
        type: "posthog",
        projectId: data.projectId,
        personalApiKey: data.personalApiKey,
        hostUrl: data.hostUrl.trim(),
      } satisfies PostHogCredentials;

      return createDataSource({
        organizationId,
        provider: "posthog",
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
        <Label htmlFor="posthog-name">Data Source Name</Label>
        <Input
          id="posthog-name"
          placeholder="My PostHog"
          {...form.register("name")}
        />
        <FormFieldError message={form.formState.errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="posthog-projectId">Project ID</Label>
        <Input
          id="posthog-projectId"
          placeholder="Enter your PostHog Project ID"
          {...form.register("projectId")}
        />
        <FormFieldError message={form.formState.errors.projectId?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="posthog-personalApiKey">Personal API Key</Label>
        <Input
          id="posthog-personalApiKey"
          type="password"
          placeholder="Enter your PostHog Personal API Key"
          {...form.register("personalApiKey")}
        />
        <FormFieldError
          message={form.formState.errors.personalApiKey?.message}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="posthog-hostUrl">Host URL</Label>
        <Input
          id="posthog-hostUrl"
          placeholder="https://us.posthog.com"
          {...form.register("hostUrl")}
        />
        <FormFieldError message={form.formState.errors.hostUrl?.message} />
        <p className="text-xs text-muted-foreground">
          Use `https://us.posthog.com`, `https://eu.posthog.com`, or your
          self-hosted base URL.
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
