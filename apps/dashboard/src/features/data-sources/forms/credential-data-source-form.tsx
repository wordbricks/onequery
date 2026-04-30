import { zodResolver } from "@hookform/resolvers/zod";
import { isRecord } from "@onequery/base";
import { CredentialsSchema } from "@onequery/db/credentials";
import type { Credentials } from "@onequery/db/credentials";
import { Input } from "@onequery/ui/components/input";
import { Label } from "@onequery/ui/components/label";
import { Textarea } from "@onequery/ui/components/textarea";
import { useState } from "react";
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

const CredentialFormSchema = z.object({
  credentialsText: z.string().optional(),
  name: z.string().min(1, "Name is required"),
  projectId: z.string().optional(),
  propertyId: z.string().optional(),
});

type CredentialFormData = z.infer<typeof CredentialFormSchema>;

type CredentialFormPayload = CredentialFormData & {
  credentials: Credentials;
};

interface CredentialDataSourceFormProps {
  provider: "ga" | "bigquery";
  onSuccess: (dataSourceId: string) => void;
  organizationId: string;
}

function getNonEmptyValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

function readStringField(
  input: Record<string, unknown>,
  key: string
): string | null {
  const value = input[key];
  if (typeof value !== "string") {
    return null;
  }
  return getNonEmptyValue(value);
}

function normalizeServiceAccountInput(
  input: Record<string, unknown>
):
  | { serviceAccount: Record<string, unknown>; projectId: string }
  | { error: string } {
  const projectId =
    readStringField(input, "project_id") ?? readStringField(input, "projectId");
  if (!projectId) {
    return { error: "Project ID is required in service account JSON" };
  }
  const clientEmail =
    readStringField(input, "client_email") ??
    readStringField(input, "clientEmail");
  if (!clientEmail) {
    return { error: "Client email is required in service account JSON" };
  }
  const privateKey =
    readStringField(input, "private_key") ??
    readStringField(input, "privateKey");
  if (!privateKey) {
    return { error: "Private key is required in service account JSON" };
  }
  const privateKeyId =
    readStringField(input, "private_key_id") ??
    readStringField(input, "privateKeyId");

  const serviceAccountBase = {
    clientEmail,
    privateKey,
    projectId,
  };
  const serviceAccount = privateKeyId
    ? { ...serviceAccountBase, privateKeyId }
    : serviceAccountBase;

  return { projectId, serviceAccount };
}

function parseCredentialsInput(
  value: string,
  provider: "ga" | "bigquery"
): { credentials: Record<string, unknown> } | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { error: "Credentials are required" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: "Credentials must be valid JSON" };
  }

  if (!isRecord(parsed)) {
    return { error: "Credentials must be a JSON object" };
  }

  const parsedType = typeof parsed.type === "string" ? parsed.type : null;
  if (parsedType === "service_account") {
    const normalized = normalizeServiceAccountInput(parsed);
    if ("error" in normalized) {
      return normalized;
    }
    const base: Record<string, unknown> = {
      authType: "service_account",
      serviceAccount: normalized.serviceAccount,
      type: provider,
    };
    if (provider === "bigquery") {
      return { credentials: { ...base, projectId: normalized.projectId } };
    }
    return { credentials: base };
  }

  if (parsedType && parsedType !== provider) {
    return { error: `Credentials type must be '${provider}'` };
  }

  const normalized = parsedType ? parsed : { ...parsed, type: provider };
  return { credentials: normalized };
}

function applyProviderFields(
  credentials: Record<string, unknown>,
  provider: "ga" | "bigquery",
  data: CredentialFormData
): { credentials: Credentials } | { error: string } {
  const base: Record<string, unknown> = { ...credentials };
  if (provider === "ga") {
    const propertyId =
      getNonEmptyValue(data.propertyId) ??
      ("propertyId" in base && typeof base.propertyId === "string"
        ? getNonEmptyValue(base.propertyId)
        : null);
    if (!propertyId) {
      return { error: "Property ID is required" };
    }
    base.propertyId = propertyId;
  }

  if (provider === "bigquery") {
    const serviceAccountProjectId =
      "serviceAccount" in base && isRecord(base.serviceAccount)
        ? readStringField(base.serviceAccount, "projectId")
        : null;
    const projectId =
      getNonEmptyValue(data.projectId) ??
      ("projectId" in base && typeof base.projectId === "string"
        ? getNonEmptyValue(base.projectId)
        : null) ??
      serviceAccountProjectId;
    if (!projectId) {
      return { error: "Project ID is required" };
    }
    base.projectId = projectId;
  }

  const result = CredentialsSchema.safeParse(base);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => issue.message)
      .join(", ");
    return { error: message };
  }

  return { credentials: result.data };
}

export function CredentialDataSourceForm({
  provider,
  onSuccess,
  organizationId,
}: CredentialDataSourceFormProps) {
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const providerLabel = provider === "ga" ? "Google Analytics" : "BigQuery";

  const form = useForm<CredentialFormData>({
    defaultValues: {
      name: "",
      credentialsText: "",
      propertyId: "",
      projectId: "",
    },
    resolver: zodResolver(CredentialFormSchema),
  });

  const mutation = useOptimisticAdd<
    { dataSource: { id: string } },
    CredentialFormPayload,
    DataSource
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      provider,
      name: data.name,
      status: "active",
      useAsDataSource: true,
      errorMessage: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    mutationFn: async (data) =>
      createDataSource({
        organizationId,
        provider,
        name: data.name,
        credentials: data.credentials,
      }),
    onError: (error) => {
      applyDataSourceNameConflictError(error, form.setError, "name");
    },
    onSuccess: (result) => {
      onSuccess(result.dataSource.id);
    },
    queryKey: dataSourcesQueryOptions(organizationId).queryKey,
    successMessage: "Data source created successfully",
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const textPromise = file.text();
    textPromise
      .then((text) => {
        form.setValue("credentialsText", text, { shouldValidate: true });
        setSelectedFileName(file.name);
        setCredentialsError(null);
      })
      .catch(() => {
        setCredentialsError("Failed to read credentials file");
      });
  };

  const credentialsField = form.register("credentialsText");

  return (
    <form
      onSubmit={form.handleSubmit((data) => {
        setCredentialsError(null);
        const credentialsText = data.credentialsText ?? "";
        if (!credentialsText.trim()) {
          setCredentialsError("Provide a credentials file or JSON.");
          return;
        }
        const parsed = parseCredentialsInput(credentialsText, provider);
        if ("error" in parsed) {
          setCredentialsError(parsed.error);
          return;
        }
        const enhanced = applyProviderFields(
          parsed.credentials,
          provider,
          data
        );
        if ("error" in enhanced) {
          setCredentialsError(enhanced.error);
          return;
        }
        mutation.mutate({ ...data, credentials: enhanced.credentials });
      })}
      className="space-y-4 py-4"
    >
      <div className="space-y-2">
        <Label htmlFor={`${provider}-credentials-name`}>Data Source Name</Label>
        <Input
          id={`${provider}-credentials-name`}
          placeholder={`My ${providerLabel}`}
          {...form.register("name")}
        />
        <FormFieldError message={form.formState.errors.name?.message} />
      </div>

      <div className="rounded-lg border border-dashed p-4">
        <div className="space-y-2">
          <Label htmlFor={`${provider}-credentials-file`}>
            Credentials File
          </Label>
          <Input
            id={`${provider}-credentials-file`}
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
          />
          {selectedFileName && (
            <p className="text-xs text-muted-foreground">
              Loaded: {selectedFileName}
            </p>
          )}
        </div>

        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          <span className="uppercase tracking-widest">Or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${provider}-credentials-text`}>
            Credentials JSON
          </Label>
          <Textarea
            id={`${provider}-credentials-text`}
            placeholder={`Paste ${providerLabel} credentials JSON`}
            rows={8}
            {...credentialsField}
            onChange={(event) => {
              void credentialsField.onChange(event);
              setCredentialsError(null);
            }}
            className="font-mono text-sm h-48 max-h-64 overflow-y-auto resize-y field-sizing-fixed"
            style={{ fieldSizing: "fixed" }}
          />
          <FormFieldError message={credentialsError} />
          <p className="text-xs text-muted-foreground">
            Include accessToken, refreshToken, and expiresAt for OAuth. Service
            account JSON is also supported. Provide
            {provider === "ga" ? " propertyId" : " projectId"} here or in the
            JSON.
          </p>
        </div>
      </div>

      {provider === "ga" && (
        <div className="space-y-2">
          <Label htmlFor="ga-property-id">Property ID</Label>
          <Input
            id="ga-property-id"
            placeholder="properties/123456789"
            {...form.register("propertyId")}
          />
          <FormFieldError message={form.formState.errors.propertyId?.message} />
        </div>
      )}

      {provider === "bigquery" && (
        <div className="space-y-2">
          <Label htmlFor="bigquery-project-id">Project ID</Label>
          <Input
            id="bigquery-project-id"
            placeholder="my-project-id"
            {...form.register("projectId")}
          />
          <FormFieldError message={form.formState.errors.projectId?.message} />
        </div>
      )}

      <FormSubmitButton
        idleLabel="Create Data Source"
        isPending={mutation.isPending}
        pendingLabel="Creating..."
      />
    </form>
  );
}
