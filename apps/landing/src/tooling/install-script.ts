import {
  createInstallScript,
  INSTALL_SCRIPT_HEADERS,
  INSTALL_SCRIPT_PATH,
} from "@onequery/installer";

const INSTALL_SCRIPT_RESPONSE_HEADERS = {
  ...INSTALL_SCRIPT_HEADERS,
  "X-Robots-Tag": "noindex",
} as const;

export interface InstallScriptAsset {
  readonly fileName: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly source: string;
}

export function createInstallScriptAsset(): InstallScriptAsset {
  return {
    fileName: INSTALL_SCRIPT_PATH.slice(1),
    headers: INSTALL_SCRIPT_RESPONSE_HEADERS,
    source: createInstallScript(),
  };
}

export function shouldServeInstallScriptRequest(
  request: Pick<Request, "method" | "url">
): boolean {
  return (
    (request.method === "GET" || request.method === "HEAD") &&
    new URL(request.url).pathname === INSTALL_SCRIPT_PATH
  );
}

export function createInstallScriptResponse(request: Request) {
  const asset = createInstallScriptAsset();

  if (!shouldServeInstallScriptRequest(request)) {
    return new Response(null, { status: 404 });
  }

  return new Response(request.method === "HEAD" ? null : asset.source, {
    headers: asset.headers,
  });
}
