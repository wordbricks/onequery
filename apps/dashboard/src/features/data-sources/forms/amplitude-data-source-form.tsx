import { zodResolver } from "@hookform/resolvers/zod";
import type { AmplitudeCredentials } from "@onequery/db";
import { Input } from "@onequery/ui/components/input";
import { Label } from "@onequery/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@onequery/ui/components/select";
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

const REGIONS = [
  { label: "US (Standard)", value: "us" },
  { label: "EU (Europe)", value: "eu" },
] as const;

const AmplitudeFormSchema = z.object({
  apiKey: z.string().min(1, "API Key is required"),
  name: z.string().min(1, "Name is required"),
  region: z.enum(["us", "eu"]),
  secretKey: z.string().min(1, "Secret Key is required"),
});

type AmplitudeFormData = z.infer<typeof AmplitudeFormSchema>;

function isAmplitudeRegion(
  value: string | null
): value is AmplitudeFormData["region"] {
  return value === "us" || value === "eu";
}

interface AmplitudeDataSourceFormProps {
  onSuccess: (dataSourceId: string) => void;
  organizationId: string;
}

export function AmplitudeDataSourceForm({
  onSuccess,
  organizationId,
}: AmplitudeDataSourceFormProps) {
  const form = useForm<AmplitudeFormData>({
    defaultValues: {
      name: "",
      apiKey: "",
      secretKey: "",
      region: "us",
    },
    resolver: zodResolver(AmplitudeFormSchema),
  });

  const mutation = useOptimisticAdd<
    { dataSource: { id: string } },
    AmplitudeFormData,
    DataSource
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      provider: "amplitude",
      name: data.name,
      status: "active",
      errorMessage: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    mutationFn: async (data) => {
      const credentials: AmplitudeCredentials = {
        type: "amplitude" as const,
        apiKey: data.apiKey,
        secretKey: data.secretKey,
        region: data.region,
      };
      return createDataSource({
        organizationId,
        provider: "amplitude",
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
        <Label htmlFor="amplitude-name">Data Source Name</Label>
        <Input
          id="amplitude-name"
          placeholder="My Amplitude"
          {...form.register("name")}
        />
        <FormFieldError message={form.formState.errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="amplitude-apiKey">API Key</Label>
        <Input
          id="amplitude-apiKey"
          placeholder="Enter your Amplitude API Key"
          {...form.register("apiKey")}
        />
        <FormFieldError message={form.formState.errors.apiKey?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="amplitude-secretKey">Secret Key</Label>
        <Input
          id="amplitude-secretKey"
          type="password"
          placeholder="Enter your Amplitude Secret Key"
          {...form.register("secretKey")}
        />
        <FormFieldError message={form.formState.errors.secretKey?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="amplitude-region">Region</Label>
        <Select
          items={[...REGIONS]}
          value={form.watch("region")}
          onValueChange={(value) => {
            if (!isAmplitudeRegion(value)) {
              return;
            }
            form.setValue("region", value);
          }}
        >
          <SelectTrigger id="amplitude-region">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REGIONS.map((region) => (
              <SelectItem key={region.value} value={region.value}>
                {region.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <FormSubmitButton
        idleLabel="Create Data Source"
        isPending={mutation.isPending}
        pendingLabel="Creating..."
      />
    </form>
  );
}
