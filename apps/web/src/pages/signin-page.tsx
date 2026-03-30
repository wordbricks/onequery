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
import { useQuery } from "@tanstack/react-query";
import {
  getRouteApi,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ThemeToggle } from "@/features/theme/theme-toggle";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { signIn, signUp } from "@/lib/auth-client";
import {
  buildPostSignUpCallbackPathFromRedirect,
  executePostAuthRedirect,
  resolvePostAuthRedirectPath,
} from "@/lib/auth-redirect";
import { authBootstrapStateQueryOptions } from "@/queries/auth-bootstrap-query";

const signInSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const signUpSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  name: z.string().min(2, "Name must be at least 2 characters"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const bootstrapSchema = signUpSchema.extend({
  organizationName: z
    .string()
    .min(2, "Organization name must be at least 2 characters"),
  organizationSlug: z
    .string()
    .min(2, "Organization slug must be at least 2 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Organization slug can only contain lowercase letters, numbers, and hyphens"
    ),
});

type SignInForm = z.infer<typeof signInSchema>;
type SignUpForm = z.infer<typeof signUpSchema>;
type BootstrapForm = z.infer<typeof bootstrapSchema>;

const routeApi = getRouteApi("/signin");

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}

function readUnexpectedAuthError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = error.message.trim();
  return message.length > 0 ? message : fallback;
}

async function readBootstrapError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null);
  const parsed = z
    .object({
      error: z.string().optional(),
      message: z.string().optional(),
    })
    .safeParse(payload);

  return (
    parsed.data?.error ?? parsed.data?.message ?? "Failed to complete bootstrap"
  );
}

export function SignInPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { redirect } = routeApi.useSearch();
  const redirectTarget = resolvePostAuthRedirectPath(redirect);
  const authBootstrapQuery = useQuery(authBootstrapStateQueryOptions());
  const authBootstrap = authBootstrapQuery.data;
  const isFirstUserBootstrap = authBootstrap?.signupMode === "first-user";
  const resolvedMode = isFirstUserBootstrap ? "signup" : mode;

  const signInForm = useForm<SignInForm>({
    defaultValues: { email: "", password: "" },
    resolver: zodResolver(signInSchema),
  });

  const signUpForm = useForm<SignUpForm>({
    defaultValues: { name: "", email: "", password: "" },
    resolver: zodResolver(signUpSchema),
  });
  const bootstrapForm = useForm<BootstrapForm>({
    defaultValues: {
      email: "",
      name: "",
      organizationName: "",
      organizationSlug: "",
      password: "",
    },
    resolver: zodResolver(bootstrapSchema),
  });
  const organizationHost =
    typeof window === "undefined" ? "your-host" : window.location.host;

  async function handleSignIn(data: SignInForm) {
    setIsSubmitting(true);

    try {
      const result = await signIn.email({
        email: data.email,
        password: data.password,
      });

      if (result.error) {
        console.error("[auth] sign-in failed", {
          error: result.error,
        });
        signInForm.setError("root", {
          message: result.error.message ?? "Invalid email or password",
        });
        setIsSubmitting(false);
        return;
      }

      await router.invalidate();
      await executePostAuthRedirect(redirectTarget, {
        navigateDocument: async (options) => navigate(options),
        navigateTo: async (to) => navigate({ to }),
      });
    } catch (error) {
      console.error("[auth] sign-in failed", {
        error,
      });
      signInForm.setError("root", {
        message: readUnexpectedAuthError(
          error,
          "Couldn't sign in right now. Try again."
        ),
      });
      setIsSubmitting(false);
    }
  }

  async function handleSignUp(data: SignUpForm) {
    setIsSubmitting(true);

    try {
      const result = await signUp.email({
        email: data.email,
        name: data.name,
        password: data.password,
      });

      if (result.error) {
        console.error("[auth] sign-up failed", {
          error: result.error,
        });
        signUpForm.setError("root", {
          message: result.error.message ?? "Failed to create account",
        });
        setIsSubmitting(false);
        return;
      }

      await navigate({
        to: buildPostSignUpCallbackPathFromRedirect(redirect),
      });
    } catch (error) {
      console.error("[auth] sign-up failed", {
        error,
      });
      signUpForm.setError("root", {
        message: readUnexpectedAuthError(
          error,
          "Couldn't create your account right now. Try again."
        ),
      });
      setIsSubmitting(false);
    }
  }

  async function handleBootstrap(data: BootstrapForm) {
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `${getApiBaseUrl()}/api/bootstrap/complete`,
        {
          body: JSON.stringify(data),
          credentials: "include",
          headers: {
            "content-type": "application/json",
          },
          method: "POST",
        }
      );

      if (!response.ok) {
        bootstrapForm.setError("root", {
          message: await readBootstrapError(response),
        });
        setIsSubmitting(false);
        return;
      }

      const payload = z
        .object({
          bootstrap: z.object({
            organizationId: z.string().min(1),
          }),
        })
        .safeParse(await response.json().catch(() => null));

      if (!payload.success) {
        bootstrapForm.setError("root", {
          message: "Bootstrap completed, but the response was invalid",
        });
        setIsSubmitting(false);
        return;
      }

      const redirectPath = `/onboarding/connect-database?orgId=${encodeURIComponent(
        payload.data.bootstrap.organizationId
      )}`;

      await router.invalidate({ sync: true });
      await navigate({
        to: buildPostSignUpCallbackPathFromRedirect(redirectPath),
      });
    } catch (error) {
      console.error("[auth] bootstrap failed", {
        error,
      });
      bootstrapForm.setError("root", {
        message: readUnexpectedAuthError(
          error,
          "Couldn't finish setup right now. Try again."
        ),
      });
      setIsSubmitting(false);
    }
  }

  function toggleMode() {
    if (isFirstUserBootstrap) {
      return;
    }

    setMode(mode === "signin" ? "signup" : "signin");
    signInForm.reset();
    signUpForm.reset();
  }

  const bootstrapOrganizationName = bootstrapForm.watch("organizationName");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background font-bold">
            V
          </div>
          <span className="font-semibold text-lg">OneQuery</span>
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">
              {resolvedMode === "signin"
                ? "Sign in to OneQuery"
                : isFirstUserBootstrap
                  ? "Create the initial owner account"
                  : "Create an account"}
            </CardTitle>
            <CardDescription>
              {resolvedMode === "signin"
                ? "Enter your email and password to continue"
                : isFirstUserBootstrap
                  ? "Finish the first-run bootstrap by creating the owner account for this self-hosted server."
                  : authBootstrap?.signupMode === "invite-only"
                    ? "Use the email address that received an invitation from your OneQuery admin."
                    : "Enter your details to get started"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {resolvedMode === "signin" ? (
              <form
                onSubmit={signInForm.handleSubmit(handleSignIn)}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="user@example.com"
                    autoComplete="email"
                    {...signInForm.register("email")}
                  />
                  {signInForm.formState.errors.email && (
                    <p className="text-sm text-destructive">
                      {signInForm.formState.errors.email.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    {...signInForm.register("password")}
                  />
                  {signInForm.formState.errors.password && (
                    <p className="text-sm text-destructive">
                      {signInForm.formState.errors.password.message}
                    </p>
                  )}
                </div>

                {signInForm.formState.errors.root && (
                  <p className="text-sm text-destructive">
                    {signInForm.formState.errors.root.message}
                  </p>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Signing in..." : "Sign in"}
                </Button>

                <p className="text-center text-sm text-muted-foreground">
                  {authBootstrap?.signupMode === "invite-only"
                    ? "Need an account? Ask an admin for an invitation, then use the invited email to sign up."
                    : "Don't have an account? "}
                  {authBootstrap?.signupMode === "invite-only" ? (
                    <button
                      type="button"
                      onClick={toggleMode}
                      className="text-foreground underline underline-offset-4 hover:text-foreground/80"
                    >
                      I have an invitation
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={toggleMode}
                      className="text-foreground underline underline-offset-4 hover:text-foreground/80"
                    >
                      Sign up
                    </button>
                  )}
                </p>
              </form>
            ) : isFirstUserBootstrap ? (
              <form
                onSubmit={bootstrapForm.handleSubmit(handleBootstrap)}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="bootstrap-name">Your name</Label>
                  <Input
                    id="bootstrap-name"
                    type="text"
                    placeholder="Jane Doe"
                    autoComplete="name"
                    {...bootstrapForm.register("name")}
                  />
                  {bootstrapForm.formState.errors.name && (
                    <p className="text-sm text-destructive">
                      {bootstrapForm.formState.errors.name.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bootstrap-email">Email</Label>
                  <Input
                    id="bootstrap-email"
                    type="email"
                    placeholder="owner@example.com"
                    autoComplete="email"
                    {...bootstrapForm.register("email")}
                  />
                  {bootstrapForm.formState.errors.email && (
                    <p className="text-sm text-destructive">
                      {bootstrapForm.formState.errors.email.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bootstrap-organization-name">
                    Organization name
                  </Label>
                  <Input
                    id="bootstrap-organization-name"
                    type="text"
                    placeholder="Acme Inc."
                    {...bootstrapForm.register("organizationName", {
                      onChange: (event) => {
                        bootstrapForm.setValue(
                          "organizationSlug",
                          generateSlug(event.target.value)
                        );
                      },
                    })}
                  />
                  {bootstrapForm.formState.errors.organizationName && (
                    <p className="text-sm text-destructive">
                      {bootstrapForm.formState.errors.organizationName.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bootstrap-organization-slug">URL slug</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {organizationHost}/
                    </span>
                    <Input
                      id="bootstrap-organization-slug"
                      placeholder="acme"
                      {...bootstrapForm.register("organizationSlug")}
                      className="flex-1"
                    />
                  </div>
                  {bootstrapForm.formState.errors.organizationSlug && (
                    <p className="text-sm text-destructive">
                      {bootstrapForm.formState.errors.organizationSlug.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="bootstrap-password">Password</Label>
                  <Input
                    id="bootstrap-password"
                    type="password"
                    placeholder="Create a password"
                    autoComplete="new-password"
                    {...bootstrapForm.register("password")}
                  />
                  {bootstrapForm.formState.errors.password && (
                    <p className="text-sm text-destructive">
                      {bootstrapForm.formState.errors.password.message}
                    </p>
                  )}
                </div>

                {bootstrapForm.formState.errors.root && (
                  <p className="text-sm text-destructive">
                    {bootstrapForm.formState.errors.root.message}
                  </p>
                )}

                <p className="text-sm text-muted-foreground">
                  This setup screen is only available until the first owner
                  account is created.
                </p>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={
                    isSubmitting ||
                    bootstrapOrganizationName.trim().length === 0
                  }
                >
                  {isSubmitting ? "Creating owner..." : "Create owner account"}
                </Button>
              </form>
            ) : (
              <form
                onSubmit={signUpForm.handleSubmit(handleSignUp)}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="John Doe"
                    autoComplete="name"
                    {...signUpForm.register("name")}
                  />
                  {signUpForm.formState.errors.name && (
                    <p className="text-sm text-destructive">
                      {signUpForm.formState.errors.name.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="user@example.com"
                    autoComplete="email"
                    {...signUpForm.register("email")}
                  />
                  {signUpForm.formState.errors.email && (
                    <p className="text-sm text-destructive">
                      {signUpForm.formState.errors.email.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="Create a password"
                    autoComplete="new-password"
                    {...signUpForm.register("password")}
                  />
                  {signUpForm.formState.errors.password && (
                    <p className="text-sm text-destructive">
                      {signUpForm.formState.errors.password.message}
                    </p>
                  )}
                </div>

                {signUpForm.formState.errors.root && (
                  <p className="text-sm text-destructive">
                    {signUpForm.formState.errors.root.message}
                  </p>
                )}

                {authBootstrap?.signupMode === "invite-only" ? (
                  <p className="text-sm text-muted-foreground">
                    Account creation is limited to email addresses with a
                    pending organization invitation.
                  </p>
                ) : null}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? "Creating account..."
                    : isFirstUserBootstrap
                      ? "Create owner account"
                      : "Create account"}
                </Button>

                {!isFirstUserBootstrap ? (
                  <p className="text-center text-sm text-muted-foreground">
                    Already have an account?{" "}
                    <button
                      type="button"
                      onClick={toggleMode}
                      className="text-foreground underline underline-offset-4 hover:text-foreground/80"
                    >
                      Sign in
                    </button>
                  </p>
                ) : null}
              </form>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
