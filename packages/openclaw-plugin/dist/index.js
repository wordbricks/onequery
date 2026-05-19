// ../../node_modules/.bun/openclaw@2026.4.10+fa3bf618afe58943/node_modules/openclaw/dist/config-schema-C7tGFgOZ.js
function error(message) {
  return {
    success: false,
    error: { issues: [{
      path: [],
      message
    }] }
  };
}
function emptyPluginConfigSchema() {
  return {
    safeParse(value) {
      if (value === undefined)
        return {
          success: true,
          data: undefined
        };
      if (!value || typeof value !== "object" || Array.isArray(value))
        return error("expected config object");
      if (Object.keys(value).length > 0)
        return error("config must be empty");
      return {
        success: true,
        data: value
      };
    },
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    }
  };
}

// ../../node_modules/.bun/openclaw@2026.4.10+fa3bf618afe58943/node_modules/openclaw/dist/plugin-entry-B1BRVa7g.js
function createCachedLazyValueGetter(value, fallback) {
  let resolved = false;
  let cached;
  return () => {
    if (!resolved) {
      cached = (typeof value === "function" ? value() : value) ?? fallback;
      resolved = true;
    }
    return cached;
  };
}
function definePluginEntry({ id, name, description, kind, configSchema = emptyPluginConfigSchema, reload, nodeHostCommands, securityAuditCollectors, register }) {
  const getConfigSchema = createCachedLazyValueGetter(configSchema);
  return {
    id,
    name,
    description,
    ...kind ? { kind } : {},
    ...reload ? { reload } : {},
    ...nodeHostCommands ? { nodeHostCommands } : {},
    ...securityAuditCollectors ? { securityAuditCollectors } : {},
    get configSchema() {
      return getConfigSchema();
    },
    register
  };
}

// src/index.ts
var src_default = definePluginEntry({
  id: "onequery",
  name: "OneQuery",
  description: "Bundles the onequery-openclaw skill for direct OneQuery CLI usage",
  register() {}
});
export {
  src_default as default
};
