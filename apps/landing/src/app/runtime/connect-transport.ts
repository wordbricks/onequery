import { createConnectTransport } from "@connectrpc/connect-web";

import { LANDING_CONNECT_PATH_PREFIX } from "../../landing/config/landing-api";

export const landingTransport = createConnectTransport({
  baseUrl: LANDING_CONNECT_PATH_PREFIX,
});
