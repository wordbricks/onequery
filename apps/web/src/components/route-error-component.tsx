import { Button, buttonVariants } from "@onequery/ui/components/button";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import {
  ErrorComponent as TanStackErrorComponent,
  Link,
  useRouter,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

export function RouteErrorComponent({ error }: ErrorComponentProps) {
  const router = useRouter();
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred";

  const handleRetry = async () => {
    await router.invalidate();
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <IconAlertTriangle
        size={48}
        className="text-destructive mb-4"
        stroke={1.5}
      />
      <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
      <p className="text-muted-foreground text-center mb-4 max-w-md">
        {message}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={handleRetry} variant="outline">
          <IconRefresh size={16} />
          Try again
        </Button>
        <Link to="/" className={buttonVariants({ variant: "outline" })}>
          Go Home
        </Link>
      </div>
      {error instanceof Error ? null : (
        <div className="mt-6 max-w-2xl">
          <TanStackErrorComponent error={error} />
        </div>
      )}
    </div>
  );
}
