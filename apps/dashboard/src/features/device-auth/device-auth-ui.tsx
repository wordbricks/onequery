import { cn } from "@onequery/ui/lib/utils";
import {
  IconCheck,
  IconKey,
  IconLogin2,
  IconShieldCheck,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";

import type { DevicePanelView, DeviceResult } from "./device-auth-machine";

type PanelTone = "neutral" | "primary" | "success" | "error";

export type PanelMeta = {
  badge: string;
  title: string;
  description: string;
  icon: typeof IconTerminal2;
  tone: PanelTone;
};

export function getPanelMeta(input: {
  panelView: DevicePanelView;
  result: DeviceResult | null;
}): PanelMeta {
  if (input.panelView === "entry") {
    return {
      badge: "Enter code",
      description:
        "Paste the code from your terminal to verify the device login request before approving access.",
      icon: IconTerminal2,
      title: "Authorize OneQuery CLI",
      tone: "primary",
    };
  }

  if (input.panelView === "verifying") {
    return {
      badge: "Checking request",
      description:
        "We’re validating the code from your terminal and loading the next step in the authorization flow.",
      icon: IconKey,
      title: "Checking device code",
      tone: "neutral",
    };
  }

  if (input.panelView === "sessionCheck") {
    return {
      badge: "Checking session",
      description:
        "We’re checking whether you already have an active OneQuery session for this device request.",
      icon: IconLogin2,
      title: "Confirming your browser session",
      tone: "neutral",
    };
  }

  if (input.panelView === "signInRequired") {
    return {
      badge: "Sign in required",
      description: "Sign in with the account that should own this CLI session.",
      icon: IconLogin2,
      title: "Sign in to approve this device",
      tone: "primary",
    };
  }

  if (input.panelView === "review") {
    return {
      badge: "Review request",
      description:
        "Review the request and decide whether to authorize this CLI sign-in.",
      icon: IconShieldCheck,
      title: "Approve device login",
      tone: "primary",
    };
  }

  if (input.result?.tone === "success") {
    return {
      badge: "Approved",
      description: input.result.message,
      icon: IconCheck,
      title: input.result.title,
      tone: "success",
    };
  }

  return {
    badge: "Denied",
    description:
      input.result?.message ??
      "This device request has been denied or could not be completed.",
    icon: IconX,
    title: input.result?.title ?? "Device Denied",
    tone: "error",
  };
}

export function getToneBadgeClasses(tone: PanelTone) {
  switch (tone) {
    case "primary": {
      return "border-primary/15 bg-primary/5 text-primary";
    }
    case "success": {
      return "border-primary/15 bg-primary/5 text-primary";
    }
    case "error": {
      return "border-destructive/15 bg-destructive/5 text-destructive";
    }
    case "neutral": {
      return "border-border bg-muted/40 text-foreground";
    }
  }
}

export function getToneIconWrapClasses(tone: PanelTone) {
  switch (tone) {
    case "primary": {
      return "bg-primary/10 text-primary";
    }
    case "success": {
      return "bg-primary/10 text-primary";
    }
    case "error": {
      return "bg-destructive/10 text-destructive";
    }
    case "neutral": {
      return "bg-background text-foreground";
    }
  }
}

export function DeviceCodeSummary({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis: "primary" | "success" | "error";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        emphasis === "error"
          ? "border-destructive/15 bg-destructive/5"
          : "border-primary/15 bg-primary/5"
      )}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-xl font-semibold tracking-[0.32em] text-foreground sm:text-2xl">
        {value}
      </p>
    </div>
  );
}

export function DeviceInfoCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "error";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        tone === "error"
          ? "border-destructive/15 bg-destructive/5"
          : "border-border bg-muted/30"
      )}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 font-medium text-foreground">{value}</p>
    </div>
  );
}
