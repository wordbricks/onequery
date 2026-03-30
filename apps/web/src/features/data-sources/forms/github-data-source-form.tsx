import { zodResolver } from "@hookform/resolvers/zod";
import type { GitHubCredentials } from "@onequery/db";
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
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";

import { applyDataSourceNameConflictError } from "./data-source-errors";

const GitHubTokenFormSchema = z.object({
  accessToken: z.string().min(1, "Access token is required"),
  name: z.string().min(1, "Name is required"),
});

type GitHubTokenFormData = z.infer<typeof GitHubTokenFormSchema>;

interface GitHubDataSourceFormProps {
  organizationId: string;
  onSuccess?: (dataSourceId: string) => void;
}

export function GitHubDataSourceForm({
  organizationId,
  onSuccess,
}: GitHubDataSourceFormProps) {
  const form = useForm<GitHubTokenFormData>({
    defaultValues: {
      name: "",
      accessToken: "",
    },
    resolver: zodResolver(GitHubTokenFormSchema),
  });

  const mutation = useOptimisticAdd<
    { dataSource: { id: string } },
    GitHubTokenFormData,
    DataSource
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      provider: "github",
      name: data.name,
      status: "active",
      useAsDataSource: true,
      errorMessage: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    mutationFn: async (data) => {
      const credentials: GitHubCredentials = {
        type: "github",
        accessToken: data.accessToken,
      };
      return createDataSource({
        organizationId,
        provider: "github",
        name: data.name,
        credentials,
      });
    },
    onError: (error) => {
      applyDataSourceNameConflictError(error, form.setError, "name");
    },
    onSuccess: (result) => {
      onSuccess?.(result.dataSource.id);
    },
    queryKey: dataSourcesQueryOptions(organizationId).queryKey,
    successMessage: "GitHub connected",
  });

  return (
    <form
      onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor="github-token-name">Data Source Name</Label>
        <Input
          id="github-token-name"
          placeholder="GitHub"
          {...form.register("name")}
        />
        <FormFieldError message={form.formState.errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="github-access-token">Access Token</Label>
        <Input
          id="github-access-token"
          type="password"
          placeholder="ghp_..."
          {...form.register("accessToken")}
        />
        <FormFieldError message={form.formState.errors.accessToken?.message} />
        <p className="text-xs text-muted-foreground">
          Use a fine-grained personal access token with read-only access to
          repositories and issues.
        </p>
      </div>

      <FormSubmitButton
        idleLabel="Connect GitHub"
        isPending={mutation.isPending}
        pendingLabel="Connecting..."
      />
    </form>
  );
}
