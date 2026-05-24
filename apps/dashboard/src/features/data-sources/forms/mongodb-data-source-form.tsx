import { zodResolver } from "@hookform/resolvers/zod";
import type { MongoDBCredentials } from "@onequery/db";
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
import type { DataSource } from "@/queries/data-sources-queries";

import { applyDataSourceNameConflictError } from "./data-source-errors";

const MongoDBFormSchema = z.object({
  connectionString: z.string().min(1, "Connection string is required"),
  database: z.string().optional(),
  databases: z.string().optional(),
  name: z.string().min(1, "Name is required"),
});

type MongoDBFormData = z.infer<typeof MongoDBFormSchema>;

interface MongoDBDataSourceFormProps {
  onSuccess: (dataSourceId: string) => void;
  organizationId: string;
}

function parseDatabaseList(value?: string): string[] | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  const values = trimmed.split(",");
  for (const entry of values) {
    const name = entry.trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    normalized.push(name);
  }
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function MongoDBDataSourceForm({
  onSuccess,
  organizationId,
}: MongoDBDataSourceFormProps) {
  const form = useForm<MongoDBFormData>({
    defaultValues: {
      name: "",
      connectionString: "",
      database: "",
      databases: "",
    },
    resolver: zodResolver(MongoDBFormSchema),
  });

  const mutation = useOptimisticAdd<
    { dataSource: { id: string } },
    MongoDBFormData,
    DataSource
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      provider: "mongodb",
      name: data.name,
      status: "active",
      errorMessage: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    mutationFn: async (data) => {
      const credentials: MongoDBCredentials = {
        type: "mongodb",
        connectionString: data.connectionString.trim(),
      };

      const database = normalizeOptionalString(data.database);
      if (database) {
        credentials.database = database;
      }

      const databases = parseDatabaseList(data.databases);
      if (databases) {
        credentials.databases = databases;
      }

      return createDataSource({
        organizationId,
        provider: "mongodb",
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

  const onSubmit = (data: MongoDBFormData) => {
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
        <Label htmlFor="mongodb-name">Data Source Name</Label>
        <Input
          id="mongodb-name"
          placeholder="MongoDB"
          {...form.register("name")}
        />
        <FormFieldError message={form.formState.errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mongodb-connection">Connection String</Label>
        <Input
          id="mongodb-connection"
          placeholder="mongodb+srv://user:pass@cluster0.example.mongodb.net/"
          className="font-mono text-sm"
          {...form.register("connectionString")}
        />
        <FormFieldError
          message={form.formState.errors.connectionString?.message}
        />
        <p className="text-xs text-muted-foreground">
          Include the database in the URL path or set it below.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mongodb-database">Default Database (optional)</Label>
        <Input
          id="mongodb-database"
          placeholder="analytics"
          {...form.register("database")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mongodb-databases">Allowed Databases (optional)</Label>
        <Textarea
          id="mongodb-databases"
          placeholder="analytics, app, reporting"
          {...form.register("databases")}
        />
        <p className="text-xs text-muted-foreground">
          Comma-separated list of databases the agent can access.
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
