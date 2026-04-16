import type { ConnectRouter } from "@connectrpc/connect";

import { CliService } from "./gen/onequery/cli/v1/cli_pb";
import { cliService } from "./service";

export function registerCliConnectRoutes(router: ConnectRouter) {
  router.service(CliService, cliService);
}
