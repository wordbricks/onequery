import { zodResolver } from "@hookform/resolvers/zod";
import type { ConnectorCredentials } from "@onequery/db";
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

const ConnectorFormSchema = z.object({
  connectorId: z.string().min(1, "Connector ID is required"),
  database: z.string().min(1, "Athena database is required"),
  name: z.string().min(1, "Name is required"),
  workgroup: z.string().optional(),
});

type ConnectorFormData = z.infer<typeof ConnectorFormSchema>;

interface ConnectorDataSourceFormProps {
  onSuccess: (dataSourceId: string) => void;
  organizationId: string;
}

export function ConnectorDataSourceForm({
  organizationId,
  onSuccess,
}: ConnectorDataSourceFormProps) {
  const form = useForm<ConnectorFormData>({
    defaultValues: {
      name: "",
      connectorId: "",
      database: "",
      workgroup: "",
    },
    resolver: zodResolver(ConnectorFormSchema),
  });

  const mutation = useOptimisticAdd<
    { dataSource: { id: string } },
    ConnectorFormData,
    DataSource
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      provider: "aws_athena_connector",
      name: data.name,
      status: "active",
      useAsDataSource: true,
      errorMessage: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    mutationFn: async (data) => {
      const credentials: ConnectorCredentials = {
        type: "aws_athena_connector",
        connectorId: data.connectorId.trim(),
        database: data.database.trim(),
      };
      const workgroup = data.workgroup?.trim();
      if (workgroup) {
        credentials.workgroup = workgroup;
      }

      return createDataSource({
        organizationId,
        provider: "aws_athena_connector",
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

  const onSubmit = (data: ConnectorFormData) => {
    mutation.mutate(data);
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="connector-name">Data Source Name</Label>
        <Input
          id="connector-name"
          placeholder="Customer Athena Connector"
          {...form.register("name")}
        />
        <FormFieldError message={form.formState.errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="connector-id">Connector ID</Label>
        <Input
          id="connector-id"
          placeholder="connector_..."
          {...form.register("connectorId")}
        />
        <FormFieldError message={form.formState.errors.connectorId?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="connector-database">Athena Database</Label>
        <Input
          id="connector-database"
          placeholder="analytics"
          {...form.register("database")}
        />
        <p className="text-sm text-muted-foreground">
          Enter the Athena or AWS Glue database name, such as{" "}
          <code>analytics</code> or <code>onequery_connector_test</code>.
        </p>
        <FormFieldError message={form.formState.errors.database?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="connector-workgroup">Athena Workgroup (optional)</Label>
        <Input
          id="connector-workgroup"
          placeholder="primary"
          {...form.register("workgroup")}
        />
        <p className="text-sm text-muted-foreground">
          Leave blank to use the default workgroup, or enter a specific
          workgroup name if your Athena setup requires one.
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
