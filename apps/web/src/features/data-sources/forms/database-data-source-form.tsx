import { zodResolver } from "@hookform/resolvers/zod";
import type { MySQLCredentials, PostgresCredentials } from "@onequery/db";
import { Input } from "@onequery/ui/components/input";
import { Label } from "@onequery/ui/components/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@onequery/ui/components/tabs";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { FormFieldError } from "@/components/form-field-error";
import { FormSubmitButton } from "@/components/form-submit-button";
import {
  buildConnectionStringFormat,
  buildConnectionStringPlaceholder,
  buildInvalidConnectionStringMessage,
  parseConnectionString,
} from "@/features/data-sources/forms/connection-string-utils";
import { DatabaseFormSchema } from "@/features/data-sources/forms/database-form-schema";
import type { DatabaseFormData } from "@/features/data-sources/forms/database-form-schema";
import { getDatabaseProviderDefaults } from "@/features/data-sources/forms/database-provider-defaults";
import type { DatabaseProviderType } from "@/features/data-sources/forms/database-provider-defaults";
import { useOptimisticAdd } from "@/lib/use-optimistic-mutation";
import {
  createDataSource,
  dataSourcesQueryOptions,
} from "@/queries/data-sources-queries";
import type { DataSource } from "@/queries/data-sources-queries";

import { applyDataSourceNameConflictError } from "./data-source-errors";

interface DatabaseDataSourceFormProps {
  provider: DatabaseProviderType;
  onSuccess: (dataSourceId: string) => void;
  organizationId: string;
}

export function DatabaseDataSourceForm({
  provider,
  onSuccess,
  organizationId,
}: DatabaseDataSourceFormProps) {
  const providerDefaults = getDatabaseProviderDefaults(provider);
  const [connectionString, setConnectionString] = useState("");
  const [connectionStringError, setConnectionStringError] = useState<
    string | null
  >(null);

  const form = useForm<DatabaseFormData>({
    defaultValues: {
      provider,
      name: "",
      host: "",
      port: providerDefaults.defaultPort,
      database: providerDefaults.defaultDatabase,
      username: "",
      password: "",
    },
    resolver: zodResolver(DatabaseFormSchema),
  });

  const mutation = useOptimisticAdd<
    { dataSource: { id: string } },
    DatabaseFormData,
    DataSource
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      provider: data.provider,
      name: data.name,
      status: "active",
      useAsDataSource: true,
      errorMessage: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    mutationFn: async (data) => {
      const defaults = getDatabaseProviderDefaults(data.provider);
      const credentials: PostgresCredentials | MySQLCredentials =
        defaults.isPostgresFamily
          ? {
              type: "postgres",
              host: data.host,
              port: data.port,
              database: data.database,
              username: data.username,
              password: data.password,
              sslMode: defaults.defaultSslMode,
            }
          : {
              type: "mysql",
              host: data.host,
              port: data.port,
              database: data.database,
              username: data.username,
              password: data.password,
              sslMode: defaults.defaultSslMode,
            };

      return createDataSource({
        organizationId,
        provider: data.provider,
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

  const onSubmitManual = (data: DatabaseFormData) => {
    mutation.mutate(data);
  };

  const onSubmitConnectionString = (e: React.FormEvent) => {
    e.preventDefault();
    setConnectionStringError(null);

    const name = form.getValues("name");
    if (!name) {
      form.setError("name", { message: "Name is required" });
      return;
    }

    const parsed = parseConnectionString(connectionString, provider);
    if (!parsed) {
      setConnectionStringError(buildInvalidConnectionStringMessage(provider));
      return;
    }

    if (!parsed.database) {
      setConnectionStringError(
        "Database name is required in connection string"
      );
      return;
    }

    if (!parsed.username) {
      setConnectionStringError("Username is required in connection string");
      return;
    }

    mutation.mutate({
      database: parsed.database,
      host: parsed.host ?? providerDefaults.fallbackHost,
      name,
      password: parsed.password ?? "",
      port: parsed.port ?? providerDefaults.defaultPort,
      provider,
      username: parsed.username,
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Data Source Name</Label>
        <Input
          id="name"
          placeholder={providerDefaults.namePlaceholder}
          {...form.register("name")}
        />
        <FormFieldError message={form.formState.errors.name?.message} />
      </div>

      <Tabs defaultValue="url">
        <TabsList className="w-full">
          <TabsTrigger value="url" className="flex-1">
            Connection URL
          </TabsTrigger>
          <TabsTrigger value="manual" className="flex-1">
            Manual
          </TabsTrigger>
        </TabsList>

        <TabsContent value="url" className="pt-4">
          <form onSubmit={onSubmitConnectionString} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="connectionString">Connection String</Label>
              <Input
                id="connectionString"
                type="text"
                placeholder={buildConnectionStringPlaceholder(provider)}
                value={connectionString}
                onChange={(e) => {
                  setConnectionString(e.target.value);
                  setConnectionStringError(null);
                }}
                className="font-mono text-sm"
              />
              <FormFieldError message={connectionStringError} />
              <p className="text-xs text-muted-foreground">
                Format: {buildConnectionStringFormat(provider)}
              </p>
            </div>
            <FormSubmitButton
              idleLabel="Create Data Source"
              isPending={mutation.isPending}
              pendingLabel="Creating..."
            />
          </form>
        </TabsContent>

        <TabsContent value="manual" className="pt-4">
          <form
            onSubmit={form.handleSubmit(onSubmitManual)}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="host">Host</Label>
                <Input
                  id="host"
                  placeholder={providerDefaults.hostPlaceholder}
                  {...form.register("host")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  {...form.register("port", { valueAsNumber: true })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="database">Database</Label>
              <Input
                id="database"
                placeholder={providerDefaults.databasePlaceholder}
                {...form.register("database")}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  placeholder={providerDefaults.usernamePlaceholder}
                  {...form.register("username")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  {...form.register("password")}
                />
              </div>
            </div>

            <FormSubmitButton
              idleLabel="Create Data Source"
              isPending={mutation.isPending}
              pendingLabel="Creating..."
            />
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}
