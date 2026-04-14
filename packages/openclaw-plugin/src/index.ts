import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { createToolRegistrations, resolvePluginConfig } from "./onequery";

export default definePluginEntry({
  id: "onequery",
  name: "OneQuery",
  description:
    "Read-only org, source, and query tools backed by the OneQuery CLI",
  register(api) {
    const config = resolvePluginConfig(api.pluginConfig);

    for (const registration of createToolRegistrations(config)) {
      api.registerTool(registration.tool, registration.options);
    }
  },
});
