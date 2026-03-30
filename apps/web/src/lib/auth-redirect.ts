import { AUTH_CALLBACK_ROUTE } from "@/lib/app-routes";

type AuthRedirectTarget = {
  kind: "app";
  path: string;
};

type AuthRedirectExecutor = {
  navigateTo: (to: string) => Promise<void> | void;
  navigateDocument: (input: {
    href: string;
    replace: true;
    reloadDocument: true;
  }) => Promise<void> | void;
};

export function parseAuthRedirectPath(
  redirectPath?: string | null
): AuthRedirectTarget | null {
  const safeRedirectPath = sanitizeRedirectPath(redirectPath);
  if (!safeRedirectPath) {
    return null;
  }

  return classifyAuthRedirectTarget(safeRedirectPath);
}

export function resolvePostAuthRedirectPath(
  redirectPath?: string | null
): AuthRedirectTarget {
  return (
    parseAuthRedirectPath(redirectPath) ?? {
      kind: "app",
      path: AUTH_CALLBACK_ROUTE,
    }
  );
}

export function buildPostSignUpCallbackPathFromRedirect(
  redirectPath?: string | null
): string {
  const safeRedirectPath = sanitizeRedirectPath(redirectPath);
  if (!safeRedirectPath) {
    return AUTH_CALLBACK_ROUTE;
  }

  const searchParams = new URLSearchParams({
    redirect: safeRedirectPath,
  });
  return `${AUTH_CALLBACK_ROUTE}?${searchParams.toString()}`;
}

export async function executePostAuthRedirect(
  target: AuthRedirectTarget,
  executor: AuthRedirectExecutor
): Promise<void> {
  await executor.navigateTo(target.path);
}

export function sanitizeRedirectPath(
  redirectPath?: string | null
): string | undefined {
  if (!redirectPath?.startsWith("/") || redirectPath.startsWith("//")) {
    return undefined;
  }

  return redirectPath;
}

function classifyAuthRedirectTarget(path: string): AuthRedirectTarget {
  return {
    kind: "app",
    path,
  };
}
