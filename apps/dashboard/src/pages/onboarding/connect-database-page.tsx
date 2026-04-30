import { IconDatabase } from "@tabler/icons-react";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { DataSourceConnectionForm } from "@/features/data-sources/data-source-connection-form";
import { organization } from "@/lib/auth-client";
import { Button } from "@/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ui/card";

const routeApi = getRouteApi("/_authenticated/onboarding/connect-database");

interface SubmitMeta {
  hasSubmitButton: boolean;
  isDisabled: boolean;
  label: string;
}

function readConnectDatabaseErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Failed to finish onboarding";
  }

  const message = error.message.trim();
  return message.length > 0 ? message : "Failed to finish onboarding";
}

async function getOrganizationSlug(organizationId: string): Promise<string> {
  // Comment: resolve the onboarding destination from the explicit org id rather
  // than the session active org. Better Auth active-org state is membership-
  // scoped, while this flow already knows the exact org it just created/used.
  const result = await organization.getFullOrganization({
    query: { organizationId },
  });

  if (!result.data?.slug) {
    throw new Error("Failed to resolve organization slug");
  }

  return result.data.slug;
}

export function ConnectDatabasePage() {
  const navigate = useNavigate();
  const search = routeApi.useSearch();
  const formContainerRef = useRef<HTMLDivElement>(null);
  const [submitMeta, setSubmitMeta] = useState<SubmitMeta>({
    hasSubmitButton: false,
    isDisabled: true,
    label: "Create Data Source",
  });

  const orgId = search.orgId;

  useEffect(() => {
    if (!orgId) {
      toast.error("Missing organization information");
      void navigate({ to: "/onboarding/create-org" });
    }
  }, [orgId, navigate]);

  function linkAndRedirect(dataSourceId: string) {
    if (!orgId) {
      return;
    }

    getOrganizationSlug(orgId)
      .then((orgSlug) => {
        toast.success(`Data source connected (${dataSourceId})`);
        return orgSlug;
      })
      .then(async (orgSlug) =>
        navigate({
          params: { org_slug: orgSlug },
          to: "/$org_slug/home",
        })
      )
      .catch((error) => {
        const message =
          error instanceof Error ? error.message : "Failed to link data source";
        toast.error(message);
      });
  }

  async function skipAndRedirect() {
    if (!orgId) {
      return;
    }

    try {
      const orgSlug = await getOrganizationSlug(orgId);
      await navigate({ params: { org_slug: orgSlug }, to: "/$org_slug/home" });
    } catch (error) {
      toast.error(readConnectDatabaseErrorMessage(error));
    }
  }

  function getActiveSubmitButton(container: HTMLDivElement | null) {
    if (!container) {
      return null;
    }

    const submitButtons = container.querySelectorAll<HTMLButtonElement>(
      "button[type='submit']"
    );
    return [...submitButtons].find((button) => {
      const form = button.closest("form");
      if (form) {
        return form.offsetParent !== null;
      }
      return button.offsetParent !== null;
    });
  }

  function handleCreateDataSource() {
    const submitButton = getActiveSubmitButton(formContainerRef.current);
    if (!submitButton || submitButton.disabled) {
      return;
    }
    submitButton.click();
  }

  useEffect(() => {
    const container = formContainerRef.current;
    if (!container) {
      return;
    }

    const updateSubmitMeta = () => {
      const submitButton = getActiveSubmitButton(container);
      if (!submitButton) {
        setSubmitMeta({
          hasSubmitButton: false,
          isDisabled: true,
          label: "Create Data Source",
        });
        return;
      }

      setSubmitMeta({
        hasSubmitButton: true,
        isDisabled: submitButton.disabled,
        label: submitButton.textContent?.trim() || "Create Data Source",
      });
    };

    updateSubmitMeta();
    const observer = new MutationObserver(updateSubmitMeta);
    observer.observe(container, {
      attributeFilter: [
        "class",
        "disabled",
        "hidden",
        "data-active",
        "data-state",
      ],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, []);

  if (!orgId) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="flex h-[min(720px,calc(100vh-3rem))] w-full max-w-md flex-col overflow-hidden">
        <CardHeader className="shrink-0 border-b text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <IconDatabase size={24} stroke={1.5} />
          </div>
          <CardTitle className="text-xl">Connect a data source</CardTitle>
          <CardDescription>
            Connect a data source to start querying your workspace data, or skip
            to explore first
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <div
            ref={formContainerRef}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <DataSourceConnectionForm
              organizationId={orgId}
              onSuccess={linkAndRedirect}
              className="px-6 py-4 [&_button[type='submit']]:sr-only"
            />
          </div>

          <div className="shrink-0 border-t px-6 py-4">
            {submitMeta.hasSubmitButton && (
              <Button
                className="w-full"
                disabled={submitMeta.isDisabled}
                onClick={handleCreateDataSource}
              >
                {submitMeta.label}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                void skipAndRedirect();
              }}
              className="mt-2 w-full"
            >
              Skip for now
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
