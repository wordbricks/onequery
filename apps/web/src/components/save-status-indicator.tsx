import { cn } from "@onequery/ui/lib/utils";
import { IconCheck, IconLoader2 } from "@tabler/icons-react";

import type { SaveStatus } from "@/lib/use-auto-save";

interface SaveStatusIndicatorProps {
  status: SaveStatus;
  className?: string;
}

export function SaveStatusIndicator({
  status,
  className,
}: SaveStatusIndicatorProps) {
  if (status === "idle") {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground transition-opacity",
        status === "error" && "text-destructive",
        className
      )}
    >
      {status === "saving" && (
        <>
          <IconLoader2 size={14} className="animate-spin" />
          <span>Saving...</span>
        </>
      )}
      {status === "saved" && (
        <>
          <IconCheck size={14} className="text-green-600" />
          <span>Saved</span>
        </>
      )}
      {status === "error" && <span>Failed to save</span>}
    </div>
  );
}
