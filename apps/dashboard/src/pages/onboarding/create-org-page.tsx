import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@onequery/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@onequery/ui/components/card";
import { Input } from "@onequery/ui/components/input";
import { Label } from "@onequery/ui/components/label";
import { IconArrowRight, IconBuilding } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { organizationsQueryOptions } from "@/features/organizations/organization-options";
import { organization } from "@/lib/auth-client";

const createOrgSchema = z.object({
  name: z.string().min(2, "Organization name must be at least 2 characters"),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers, and hyphens"
    ),
});

type CreateOrgForm = z.infer<typeof createOrgSchema>;

const routeApi = getRouteApi("/_authenticated/onboarding/create-org");

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

function readCreateOrganizationErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Failed to create organization";
  }

  const message = error.message.trim();
  return message.length > 0 ? message : "Failed to create organization";
}

export function CreateOrgPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { auth, refetchSession } = routeApi.useRouteContext();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const userId = auth.session?.user.id;
  const organizationHost =
    typeof window === "undefined" ? "your-host" : window.location.host;

  const form = useForm<CreateOrgForm>({
    defaultValues: {
      name: "",
      slug: "",
    },
    resolver: zodResolver(createOrgSchema),
  });

  const nameValue = form.watch("name");
  const slugValue = form.watch("slug");

  async function onSubmit(data: CreateOrgForm) {
    setIsSubmitting(true);

    try {
      const result = await organization.create({
        name: data.name,
        slug: data.slug,
      });

      if (result.error) {
        form.setError("root", {
          message: result.error.message ?? "Failed to create organization",
        });
        setIsSubmitting(false);
        return;
      }

      const orgId = result.data?.id;
      if (!orgId) {
        form.setError("root", {
          message: "Failed to create organization",
        });
        setIsSubmitting(false);
        return;
      }

      await organization.setActive({ organizationId: orgId });
      await refetchSession();
      await queryClient.invalidateQueries({
        queryKey: organizationsQueryOptions(userId).queryKey,
      });

      await navigate({
        search: { orgId },
        to: "/onboarding/connect-database",
      });
    } catch (error) {
      form.setError("root", {
        message: readCreateOrganizationErrorMessage(error),
      });
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <IconBuilding size={24} stroke={1.5} />
          </div>
          <CardTitle className="text-xl">Create your organization</CardTitle>
          <CardDescription>
            Set up your workspace to get started with OneQuery
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Organization name</Label>
              <Input
                id="name"
                placeholder="Acme Inc."
                {...form.register("name", {
                  onChange: (e) => {
                    const slug = generateSlug(e.target.value);
                    form.setValue("slug", slug);
                  },
                })}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug">URL slug</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {organizationHost}/
                </span>
                <Input
                  id="slug"
                  placeholder="acme"
                  {...form.register("slug")}
                  className="flex-1"
                />
              </div>
              {form.formState.errors.slug && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.slug.message}
                </p>
              )}
            </div>

            {form.formState.errors.root && (
              <p className="text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isSubmitting || !nameValue || !slugValue}
            >
              {isSubmitting ? "Setting up..." : "Continue"}
              <IconArrowRight size={16} stroke={2} />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
