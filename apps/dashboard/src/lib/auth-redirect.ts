import {
  AUTH_CALLBACK_ROUTE,
  buildConnectDatabasePath,
  buildDeviceAuthPath,
  DEVICE_ROUTE,
} from "@/lib/app-routes";

type AuthRedirectTarget = {
  kind: "app";
  path: string;
};

type BootstrapCompletionRedirectInput = {
  organizationId: string;
  redirectPath?: string | null;
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

export function resolveBootstrapCompletionRedirectPath(
  input: BootstrapCompletionRedirectInput
): string {
  const fallbackPath = buildConnectDatabasePath(input.organizationId);
  const redirectTarget = parseAuthRedirectPath(input.redirectPath);
  if (!redirectTarget) {
    return fallbackPath;
  }

  const redirectUrl = parseAppRedirectUrl(redirectTarget.path);
  if (!redirectUrl || redirectUrl.pathname !== DEVICE_ROUTE) {
    return fallbackPath;
  }

  const deviceRedirectPath = buildDeviceAuthPath(
    redirectUrl.searchParams.get("user_code"),
    input.organizationId
  );
  return deviceRedirectPath === DEVICE_ROUTE
    ? fallbackPath
    : deviceRedirectPath;
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

function parseAppRedirectUrl(path: string): URL | null {
  try {
    return new URL(path, "https://onequery.local");
  } catch {
    return null;
  }
}
