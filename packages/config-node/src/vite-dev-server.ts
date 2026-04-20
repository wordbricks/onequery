import { projectViteDevServerConfig } from "@onequery/config/projections/vite";
import type { ViteDevServerProjection } from "@onequery/config/projections/vite";

import { loadWorkspaceDev } from "./workspace-dev";
import type { LoadWorkspaceDevOptions } from "./workspace-dev";

export function loadViteDevServerConfig(
  input: LoadWorkspaceDevOptions = {}
): ViteDevServerProjection {
  return projectViteDevServerConfig(loadWorkspaceDev(input));
}
