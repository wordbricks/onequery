// @ts-expect-error -- openclaw SDK types are resolved at build time by the host
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "onequery",
  name: "OneQuery",
  description:
    "Bundles the onequery-openclaw skill for direct OneQuery CLI usage",
  register() {
    // Surprising: OpenClaw plugin packages still need a runtime entry even when
    // the actual integration is just bundled skill content.
  },
});
