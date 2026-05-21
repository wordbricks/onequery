import { zodResolver } from "@hookform/resolvers/zod";
import type { SnowflakeCredentials } from "@onequery/db";
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

const SnowflakeFormSchema = z.object({
  account: z.string().min(1, "Account identifier is required"),
  database: z.string().min(1, "Database is required"),
  name: z.string().min(1, "Name is required"),
  password: z.string().min(1, "Password is required"),
  role: z.string().optional(),
  schema: z.string().optional(),
  username: z.string().min(1, "Username is required"),
  warehouse: z.string().min(1, "Warehouse is required"),
});

type SnowflakeFormData = z.infer<typeof SnowflakeFormSchema>;

interface SnowflakeDataSourceFormProps {
  onSuccess: (dataSourceId: string) => void;
  organizationId: string;
}

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function SnowflakeDataSourceForm({
  onSuccess,
  organizationId,
}: SnowflakeDataSourceFormProps) {
  const form = useForm<SnowflakeFormData>({
    defaultValues: {
      account: "",
      database: "",
      name: "",
      password: "",
      role: "",
      schema: "PUBLIC",
      username: "",
      warehouse: "",
    },
    resolver: zodResolver(SnowflakeFormSchema),
  });

  const mutation = useOptimisticAdd<
    { dataSource: { id: string } },
    SnowflakeFormData,
    DataSource
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      provider: "snowflake",
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
        account: data.account.trim(),
        database: data.database.trim(),
        password: data.password,
        role: normalizeOptionalString(data.role),
        schema: normalizeOptionalString(data.schema),
        type: "snowflake",
        username: data.username.trim(),
        warehouse: data.warehouse.trim(),
      } satisfies SnowflakeCredentials;

      return createDataSource({
        organizationId,
        provider: "snowflake",
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

  const onSubmit = (data: SnowflakeFormData) => {
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
        <Label htmlFor="snowflake-name">Data Source Name</Label>
        <Input
          id="snowflake-name"
          placeholder="Snowflake Production"
          {...form.register("name")}
        />
        <FormFieldError message={form.formState.errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="snowflake-account">Account Identifier</Label>
        <Input
          id="snowflake-account"
          placeholder="xy12345.us-east-1"
          {...form.register("account")}
        />
        <FormFieldError message={form.formState.errors.account?.message} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="snowflake-warehouse">Warehouse</Label>
          <Input
            id="snowflake-warehouse"
            placeholder="ANALYTICS_WH"
            {...form.register("warehouse")}
          />
          <FormFieldError message={form.formState.errors.warehouse?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="snowflake-database">Database</Label>
          <Input
            id="snowflake-database"
            placeholder="ANALYTICS"
            {...form.register("database")}
          />
          <FormFieldError message={form.formState.errors.database?.message} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="snowflake-schema">Schema</Label>
          <Input
            id="snowflake-schema"
            placeholder="PUBLIC"
            {...form.register("schema")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="snowflake-role">Role</Label>
          <Input
            id="snowflake-role"
            placeholder="ONEQUERY_READONLY"
            {...form.register("role")}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="snowflake-username">Username</Label>
          <Input
            id="snowflake-username"
            placeholder="ONEQUERY_READER"
            {...form.register("username")}
          />
          <FormFieldError message={form.formState.errors.username?.message} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="snowflake-password">Password</Label>
          <Input
            id="snowflake-password"
            type="password"
            {...form.register("password")}
          />
          <FormFieldError message={form.formState.errors.password?.message} />
        </div>
      </div>

      <FormSubmitButton
        idleLabel="Create Data Source"
        isPending={mutation.isPending}
        pendingLabel="Creating..."
      />
    </form>
  );
}
