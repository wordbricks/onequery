import { Button } from "@onequery/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@onequery/ui/components/card";
import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";

import { useInviteAcceptController } from "@/features/invite-accept/invite-accept-controller";

export function InviteAcceptPage() {
  const { accept, decline, errorMessage, goHome, status } =
    useInviteAcceptController();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Organization Invitation</CardTitle>
          <CardDescription>
            You've been invited to join an organization
          </CardDescription>
        </CardHeader>

        <CardContent className="flex justify-center py-8">
          {status === "ready" && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-primary/10 p-4">
                <IconCheck size={48} className="text-primary" />
              </div>
              <div>
                <p className="font-medium">Ready to join</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Click the button below to accept the invitation and join the
                  organization.
                </p>
              </div>
            </div>
          )}

          {status === "accepting" && (
            <div className="flex flex-col items-center gap-4">
              <IconLoader2 size={48} className="animate-spin text-primary" />
              <p className="text-muted-foreground">Accepting invitation...</p>
            </div>
          )}

          {status === "success" && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-green-500/10 p-4">
                <IconCheck size={48} className="text-green-500" />
              </div>
              <div>
                <p className="font-medium text-green-600">
                  Successfully joined!
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Redirecting to your dashboard...
                </p>
              </div>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="rounded-full bg-destructive/10 p-4">
                <IconX size={48} className="text-destructive" />
              </div>
              <div>
                <p className="font-medium text-destructive">
                  Failed to accept invitation
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {errorMessage ||
                    "The invitation may have expired or already been used."}
                </p>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-center gap-4">
          {status === "ready" && (
            <>
              <Button variant="outline" onClick={decline}>
                Decline
              </Button>
              <Button onClick={accept}>Accept Invitation</Button>
            </>
          )}

          {status === "error" && (
            <Button variant="outline" onClick={goHome}>
              Go to Home
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
