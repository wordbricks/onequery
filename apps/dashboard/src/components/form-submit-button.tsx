import { Button } from "@onequery/ui/components/button";
import { Spinner } from "@onequery/ui/components/spinner";
import { cn } from "@onequery/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";

interface FormSubmitButtonProps extends Omit<
  ComponentProps<typeof Button>,
  "children" | "type"
> {
  idleLabel: ReactNode;
  pendingLabel?: ReactNode;
  isPending?: boolean;
  fullWidth?: boolean;
}

export function FormSubmitButton({
  className,
  disabled,
  fullWidth = true,
  idleLabel,
  isPending = false,
  pendingLabel,
  ...props
}: FormSubmitButtonProps) {
  return (
    <Button
      type="submit"
      aria-busy={isPending}
      className={cn(fullWidth && "w-full", className)}
      disabled={disabled || isPending}
      {...props}
    >
      {isPending ? (
        <>
          <Spinner className="size-4" />
          <span>{pendingLabel ?? idleLabel}</span>
        </>
      ) : (
        idleLabel
      )}
    </Button>
  );
}
