import { zodResolver } from "@hookform/resolvers/zod";
import type { MixpanelCredentials } from "@onequery/db";
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

const MixpanelFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  projectId: z.string().min(1, "Project ID is required"),
  region: z.enum(["us", "eu", "in"]),
  secret: z.string().min(1, "Service Account Secret is required"),
  username: z.string().min(1, "Service Account Username is required"),
  workspaceId: z.string().optional(),
});

const REGIONS = [
  { label: "US (Standard)", value: "us" },
  { label: "EU (Europe)", value: "eu" },
  { label: "IN (India)", value: "in" },
] as const;

type MixpanelFormData = z.infer<typeof MixpanelFormSchema>;

function isMixpanelRegion(
  value: string | null
): value is MixpanelFormData["region"] {
  return value === "us" || value === "eu" || value === "in";
}

interface MixpanelDataSourceFormProps {
  onSuccess: (dataSourceId: string) => void;
  organizationId: string;
}

export function MixpanelDataSourceForm({
  onSuccess,
  organizationId,
}: MixpanelDataSourceFormProps) {
  const form = useForm<MixpanelFormData>({
    defaultValues: {
      name: "",
      username: "",
      secret: "",
      projectId: "",
      workspaceId: "",
      region: "us",
    },
    resolver: zodResolver(MixpanelFormSchema),
  });

  const mutation = useOptimisticAdd<
    { dataSource: { id: string } },
    MixpanelFormData,
    DataSource
  >({
    createOptimisticItem: (data) => ({
      id: `temp-${crypto.randomUUID()}`,
      provider: "mixpanel",
      name: data.name,
      status: "active",
      errorMessage: null,
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    mutationFn: async (data) => {
      const credentials: MixpanelCredentials = {
        type: "mixpanel" as const,
        username: data.username,
        secret: data.secret,
        projectId: data.projectId,
        workspaceId: data.workspaceId?.trim() || undefined,
        region: data.region,
      };
      return createDataSource({
        organizationId,
        provider: "mixpanel",
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
        <Label htmlFor="mixpanel-name">Data Source Name</Label>
        <Input
          id="mixpanel-name"
          placeholder="My Mixpanel"
          {...form.register("name")}
        />
        <FormFieldError message={form.formState.errors.name?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mixpanel-projectId">Project ID</Label>
        <Input
          id="mixpanel-projectId"
          placeholder="Enter your Mixpanel Project ID"
          {...form.register("projectId")}
        />
        <FormFieldError message={form.formState.errors.projectId?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mixpanel-username">Service Account Username</Label>
        <Input
          id="mixpanel-username"
          placeholder="Enter your Service Account Username"
          {...form.register("username")}
        />
        <FormFieldError message={form.formState.errors.username?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mixpanel-secret">Service Account Secret</Label>
        <Input
          id="mixpanel-secret"
          type="password"
          placeholder="Enter your Service Account Secret"
          {...form.register("secret")}
        />
        <FormFieldError message={form.formState.errors.secret?.message} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mixpanel-workspaceId">Workspace ID (optional)</Label>
        <Input
          id="mixpanel-workspaceId"
          placeholder="Enter workspace ID if your project uses Data Views"
          {...form.register("workspaceId")}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mixpanel-region">Region</Label>
        <Select
          items={[...REGIONS]}
          value={form.watch("region")}
          onValueChange={(value) => {
            if (!isMixpanelRegion(value)) {
              return;
            }
            form.setValue("region", value);
          }}
        >
          <SelectTrigger id="mixpanel-region">
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
