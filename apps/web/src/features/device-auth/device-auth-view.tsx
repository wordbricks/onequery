import { Button, buttonVariants } from "@onequery/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@onequery/ui/components/card";
import { Input } from "@onequery/ui/components/input";
import { Label } from "@onequery/ui/components/label";
import { cn } from "@onequery/ui/lib/utils";
import { IconLogin2, IconSparkles } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";

import { ThemeToggle } from "@/features/theme/theme-toggle";
import {
  CONNECT_DATABASE_ROUTE,
  ROOT_ROUTE,
  SIGNIN_ROUTE,
} from "@/lib/app-routes";

import type { DeviceAuthController } from "./device-auth-controller";
import {
  DeviceCodeSummary,
  DeviceInfoCard,
  getToneBadgeClasses,
  getToneIconWrapClasses,
} from "./device-auth-ui";

export function DeviceAuthView({
  controller,
}: {
  controller: DeviceAuthController;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-7rem] top-[-8rem] h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute right-[-8rem] top-20 h-80 w-80 rounded-full bg-muted blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(127,127,127,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(127,127,127,0.06)_1px,transparent_1px)] bg-[size:4.5rem_4.5rem] [mask-image:linear-gradient(to_bottom,white,rgba(255,255,255,0.3))]" />
      </div>

      <header className="relative z-10 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link to={ROOT_ROUTE} className="flex items-center gap-3">
            <img
              src="/onequery.svg"
              alt="OneQuery"
              className="h-9 w-9 rounded-lg"
            />
            <div>
              <p className="font-semibold text-lg leading-none">OneQuery</p>
              <p className="text-xs text-muted-foreground">
                Device authorization
              </p>
            </div>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-6 py-10 lg:min-h-[calc(100vh-4rem)] lg:py-14">
        <section className="w-full max-w-3xl">
          <div className="rounded-[2rem] border border-border/70 bg-background/75 p-2 shadow-2xl shadow-foreground/5 backdrop-blur">
            <Card className="w-full border-0 bg-card/95 shadow-none ring-0">
              <CardHeader className="border-b border-border/60 pb-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em]",
                      getToneBadgeClasses(controller.panelMeta.tone)
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full",
                        getToneIconWrapClasses(controller.panelMeta.tone)
                      )}
                    >
                      <controller.panelMeta.icon size={14} stroke={1.9} />
                    </div>
                    {controller.panelMeta.badge}
                  </div>
                </div>
                <CardTitle className="mt-4 text-2xl">
                  {controller.panelMeta.title}
                </CardTitle>
                <CardDescription className="max-w-2xl text-base leading-7">
                  {controller.panelMeta.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 pt-6">
                {controller.errorMessage ? (
                  <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {controller.errorMessage}
                  </div>
                ) : null}
                {renderPanelContent(controller)}
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
    </div>
  );
}

function renderPanelContent(controller: DeviceAuthController) {
  switch (controller.panelView) {
    case "entry": {
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            controller.onSubmit();
          }}
          className="space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor="user-code">Device code</Label>
            <Input
              id="user-code"
              value={controller.inputCode}
              onChange={(event) => controller.onInputChange(event.target.value)}
              placeholder="ABCD1234"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              required
              className="h-11 font-mono text-base tracking-[0.25em] uppercase"
            />
            <p className="text-sm text-muted-foreground">
              Enter the 8-character code shown in your terminal.
            </p>
          </div>

          <div className="space-y-3">
            <Button type="submit" className="h-11 w-full">
              Continue
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              You’ll review the request before any access is granted.
            </p>
          </div>
        </form>
      );
    }
    case "verifying": {
      return (
        <div className="space-y-4">
          <DeviceCodeSummary
            label="Verifying code"
            value={controller.activeUserCode ?? controller.inputCode}
            emphasis="primary"
          />
          <div className="rounded-2xl border bg-muted/40 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <IconSparkles size={18} stroke={1.75} />
              </div>
              <div>
                <p className="font-medium">Checking request details</p>
                <p className="text-sm text-muted-foreground">
                  We’re validating that this device code is still active and can
                  be approved.
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }
    case "sessionCheck": {
      return (
        <div className="space-y-4">
          <DeviceCodeSummary
            label="Ready to approve"
            value={controller.activeUserCode ?? ""}
            emphasis="primary"
          />
          <div className="rounded-2xl border bg-muted/40 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted">
                <IconLogin2 size={18} stroke={1.75} />
              </div>
              <div>
                <p className="font-medium">Checking your browser session</p>
                <p className="text-sm text-muted-foreground">
                  Once we know who you are, you’ll be able to approve or deny
                  this request.
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }
    case "signInRequired": {
      return (
        <div className="space-y-4">
          <DeviceCodeSummary
            label="Device code"
            value={controller.activeUserCode ?? ""}
            emphasis="primary"
          />
          <Link
            to={SIGNIN_ROUTE}
            search={{ redirect: controller.resumePath }}
            className={buttonVariants({
              variant: "default",
              size: "lg",
              className: "h-11 w-full",
            })}
          >
            Sign in
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mx-auto flex h-9 px-3 text-muted-foreground"
            onClick={controller.onUseDifferentCode}
          >
            Use a different code
          </Button>
        </div>
      );
    }
    case "review": {
      return controller.sessionEmail ? (
        <div className="space-y-4">
          <DeviceCodeSummary
            label="Device code"
            value={controller.activeUserCode ?? ""}
            emphasis="primary"
          />
          <DeviceInfoCard
            label="Signed in as"
            value={controller.sessionEmail}
            tone="neutral"
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 flex-1"
              onClick={controller.onDeny}
              disabled={
                controller.isSubmittingApprove || controller.isSubmittingDeny
              }
            >
              {controller.isSubmittingDeny ? "Denying..." : "Deny"}
            </Button>
            <Button
              type="button"
              size="lg"
              className="h-11 flex-1"
              onClick={controller.onApprove}
              disabled={
                controller.isSubmittingApprove || controller.isSubmittingDeny
              }
            >
              {controller.isSubmittingApprove ? "Approving..." : "Approve"}
            </Button>
          </div>
        </div>
      ) : null;
    }
    case "result": {
      return controller.result ? (
        <div className="space-y-4">
          <DeviceCodeSummary
            label={
              controller.result.tone === "success"
                ? "Approved code"
                : "Resolved code"
            }
            value={controller.activeUserCode ?? ""}
            emphasis={controller.result.tone}
          />
          {controller.result.tone === "success" &&
          controller.onboardingOrganizationId ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Your CLI session is ready. Connect a data source now, or come
                back later from the dashboard.
              </p>
              <Link
                to={CONNECT_DATABASE_ROUTE}
                search={{ orgId: controller.onboardingOrganizationId }}
                className={buttonVariants({
                  variant: "default",
                  size: "lg",
                  className: "h-11 w-full",
                })}
              >
                Continue setup
              </Link>
            </div>
          ) : null}
        </div>
      ) : null;
    }
  }
}
