import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  loadConfigFromSourcesSync,
  readTomlFileSync,
} from "@onequery/config-loader";
import {
  LOCAL_AGENT_ORIGIN,
  LOCAL_DATABASE_URL,
  LOCAL_WEB_DOCKER_ORIGIN,
  LOCAL_WEB_ORIGIN,
} from "@onequery/dev-config/topology";
import { z } from "zod";

const DOCKER_URL = LOCAL_WEB_DOCKER_ORIGIN;
const LOCAL_CONFIG_RELATIVE_PATH = "onequery.local.env.toml";
const LOCAL_CONFIG_TEMPLATE_RELATIVE_PATH = "onequery.local.env.toml.template";
const LOCAL_CONFIG_HEADER = [
  "# Generated from packages/dev-config/src/local-env.ts via `bun run env:sync`.",
  "# Managed local-development values live here.",
  "# Edit this TOML file directly; process env is only for explicit overrides at",
  "# command launch time.",
  "",
].join("\n");

type LocalConfigConsumer = "db" | "server" | "web";
type LocalConfigGroup = "core-runtime" | "dev-flags" | "optional-integrations";
type LocalConfigValueKind = "boolean" | "string" | "url";

interface ManagedLocalConfigFieldDefinition {
  readonly consumers: readonly LocalConfigConsumer[];
  readonly defaultValue: string;
  readonly description: string;
  readonly group: LocalConfigGroup;
  readonly key: string;
  readonly optional: boolean;
  readonly seedLocalValue?: () => string;
  readonly valueKind?: LocalConfigValueKind;
}

type ManagedLocalConfigValues = Record<string, string>;
type ManagedLocalConfigSource = Record<string, unknown>;

interface ManagedLocalConfigValidation {
  readonly errors: readonly string[];
  readonly missingKeys: readonly string[];
}

export interface ManagedLocalConfigSyncResult extends ManagedLocalConfigValidation {
  readonly addedKeys: readonly string[];
  readonly created: boolean;
  readonly path: string;
}

const GENERATED_BETTER_AUTH_SECRET_PLACEHOLDER = "generated-by-config-sync";

export const MANAGED_LOCAL_CONFIG_FIELDS = [
  {
    consumers: ["web", "server"],
    defaultValue: LOCAL_DATABASE_URL,
    description:
      "Local Postgres connection string for development and Drizzle.",
    group: "core-runtime",
    key: "DATABASE_URL",
    optional: false,
  },
  {
    consumers: ["web", "server"],
    defaultValue: LOCAL_WEB_ORIGIN,
    description: "Base URL used for Better Auth callbacks and links.",
    group: "core-runtime",
    key: "BETTER_AUTH_URL",
    optional: false,
    valueKind: "url",
  },
  {
    consumers: ["web", "server"],
    defaultValue: LOCAL_WEB_ORIGIN,
    description: "Public web origin used for local callbacks and asset links.",
    group: "core-runtime",
    key: "WEB_URL",
    optional: false,
    valueKind: "url",
  },
  {
    consumers: ["web", "server"],
    defaultValue: GENERATED_BETTER_AUTH_SECRET_PLACEHOLDER,
    description:
      "Development-only Better Auth signing key. Seeded randomly when missing.",
    group: "core-runtime",
    key: "BETTER_AUTH_SECRET",
    optional: false,
    seedLocalValue: generateBetterAuthSecret,
  },
  {
    consumers: ["web", "server"],
    defaultValue: "dev-connector-token",
    description:
      "Shared enrollment token for connector registration in local dev.",
    group: "core-runtime",
    key: "CONNECTOR_ENROLLMENT_TOKEN",
    optional: false,
  },
  {
    consumers: ["web", "server"],
    defaultValue: "sample-encryption-key",
    description:
      "Sample placeholder for the key used to encrypt stored credentials.",
    group: "core-runtime",
    key: "MASTER_ENCRYPTION_KEY",
    optional: false,
  },
  {
    consumers: ["web", "server"],
    defaultValue: "true",
    description: "Disable API rate limiting for local development and e2e.",
    group: "core-runtime",
    key: "DISABLE_RATE_LIMIT",
    optional: false,
    valueKind: "boolean",
  },
] as const satisfies readonly ManagedLocalConfigFieldDefinition[];

export type ManagedLocalConfigKey =
  (typeof MANAGED_LOCAL_CONFIG_FIELDS)[number]["key"];

const CONFIG_GROUPS: ReadonlyArray<{
  description: string;
  key: LocalConfigGroup;
  title: string;
}> = [
  {
    description:
      "Baseline local runtime values needed for the OSS web, server, and DB loop.",
    key: "core-runtime",
    title: "Core Runtime",
  },
  {
    description:
      "Integrations that are optional for onboarding and can stay blank until needed.",
    key: "optional-integrations",
    title: "Optional Integrations",
  },
  {
    description:
      "Frontend and test toggles that are useful locally but not required.",
    key: "dev-flags",
    title: "Dev Flags",
  },
];

function normalizeManagedLocalBooleanValue(value: unknown): unknown {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return value;
}

function createManagedLocalConfigFieldSchema(
  definition: ManagedLocalConfigFieldDefinition
): z.ZodTypeAny {
  if (definition.valueKind === "boolean") {
    return z.preprocess(
      normalizeManagedLocalBooleanValue,
      z.custom<boolean>((value) => typeof value === "boolean", {
        message: `${definition.key} must be "true" or "false"`,
      })
    );
  }

  return z
    .preprocess(
      (value) => (typeof value === "string" ? value.trim() : value),
      z.custom<string>((value) => typeof value === "string", {
        message: `${definition.key} must be a string`,
      })
    )
    .superRefine((value, context) => {
      if (value.length === 0) {
        if (!definition.optional) {
          context.addIssue({
            code: "custom",
            message: `${definition.key} must not be empty`,
          });
        }

        return;
      }

      if (definition.valueKind !== "url") {
        return;
      }

      try {
        const parsed = new URL(value);
        if (!parsed.protocol || !parsed.host) {
          throw new Error("invalid-url");
        }
      } catch {
        context.addIssue({
          code: "custom",
          message: `${definition.key} must be a valid URL`,
        });
      }
    });
}

function createManagedLocalConfigObjectSchema(options: {
  readonly requireAllFields: boolean;
}): z.ZodObject<z.ZodRawShape> {
  const shape = Object.fromEntries(
    MANAGED_LOCAL_CONFIG_FIELDS.map((definition) => {
      const valueSchema = createManagedLocalConfigFieldSchema(definition);

      return [
        definition.key,
        options.requireAllFields && !definition.optional
          ? valueSchema
          : valueSchema.optional(),
      ];
    })
  ) as z.ZodRawShape;

  return z.object(shape);
}

export const managedLocalConfigSourceSchema =
  createManagedLocalConfigObjectSchema({
    requireAllFields: false,
  });

const managedLocalConfigSchema = createManagedLocalConfigObjectSchema({
  requireAllFields: true,
});

function escapeTomlValue(
  value: string,
  kind: LocalConfigValueKind = "string"
): string {
  if (kind === "boolean") {
    return value;
  }

  return JSON.stringify(value);
}

function generateBetterAuthSecret(): string {
  return randomBytes(32).toString("base64url");
}

function resolveManagedLocalSeedValue(
  definition: ManagedLocalConfigFieldDefinition
): string {
  // Generate local-only seed values once so repeat syncs never rotate auth state.
  return definition.seedLocalValue?.() ?? definition.defaultValue;
}

function renderManagedLocalConfigLine(
  definition: ManagedLocalConfigFieldDefinition,
  value: string
): string {
  const consumers = definition.consumers.join(", ");

  return [
    `# ${definition.key}: ${definition.description}`,
    `# consumers: ${consumers}`,
    `${definition.key} = ${escapeTomlValue(value, definition.valueKind)}`,
  ].join("\n");
}

function selectManagedLocalConfigFields(
  keys?: readonly ManagedLocalConfigKey[]
): readonly (typeof MANAGED_LOCAL_CONFIG_FIELDS)[number][] {
  if (!keys) {
    return MANAGED_LOCAL_CONFIG_FIELDS;
  }

  const selectedKeys = new Set(keys);

  return MANAGED_LOCAL_CONFIG_FIELDS.filter((definition) =>
    selectedKeys.has(definition.key)
  );
}

export function getManagedLocalConfigDefaults(
  keys?: readonly ManagedLocalConfigKey[]
): ManagedLocalConfigValues {
  return Object.fromEntries(
    selectManagedLocalConfigFields(keys).map((definition) => [
      definition.key,
      definition.defaultValue,
    ])
  );
}

function getManagedLocalSeedValues(): ManagedLocalConfigValues {
  return Object.fromEntries(
    MANAGED_LOCAL_CONFIG_FIELDS.map((definition) => [
      definition.key,
      resolveManagedLocalSeedValue(definition),
    ])
  );
}

export function getLocalConfigTemplatePath(
  rootDir: string = process.cwd()
): string {
  return join(rootDir, LOCAL_CONFIG_TEMPLATE_RELATIVE_PATH);
}

export function getLocalConfigPath(rootDir: string = process.cwd()): string {
  return join(rootDir, LOCAL_CONFIG_RELATIVE_PATH);
}

export function renderManagedLocalConfigFile(
  values: ManagedLocalConfigValues = getManagedLocalConfigDefaults()
): string {
  const sections = CONFIG_GROUPS.map((group) => {
    const entries = MANAGED_LOCAL_CONFIG_FIELDS.filter(
      (definition) => definition.group === group.key
    );
    if (entries.length === 0) {
      return null;
    }

    const body = entries
      .map((definition) =>
        renderManagedLocalConfigLine(
          definition,
          values[definition.key] ?? definition.defaultValue
        )
      )
      .join("\n\n");

    return [
      `# === ${group.title} ===`,
      `# ${group.description}`,
      "",
      body,
    ].join("\n");
  }).filter((section): section is string => section !== null);

  return `${LOCAL_CONFIG_HEADER}${sections.join("\n\n")}\n`;
}

function formatManagedLocalConfigErrors(error: z.ZodError): string[] {
  const seen = new Set<string>();

  return error.issues.flatMap((issue) => {
    if (seen.has(issue.message)) {
      return [];
    }

    seen.add(issue.message);
    return [issue.message];
  });
}

function validateManagedLocalConfigValues(
  values: ManagedLocalConfigSource
): ManagedLocalConfigValidation {
  const missingKeys = MANAGED_LOCAL_CONFIG_FIELDS.filter(
    (definition) => !definition.optional && !(definition.key in values)
  ).map((definition) => definition.key);
  const parsed = managedLocalConfigSchema.safeParse(values);
  const errors = parsed.success
    ? []
    : formatManagedLocalConfigErrors(parsed.error);

  return {
    errors,
    missingKeys,
  };
}

function serializeManagedLocalValues(
  values: ManagedLocalConfigSource
): ManagedLocalConfigValues {
  const serialized: ManagedLocalConfigValues = {};

  for (const definition of MANAGED_LOCAL_CONFIG_FIELDS) {
    const value = values[definition.key];
    if (value === undefined) {
      continue;
    }

    if (typeof value === "boolean") {
      serialized[definition.key] = value ? "true" : "false";
      continue;
    }

    if (typeof value === "string") {
      serialized[definition.key] = value;
    }
  }

  return serialized;
}

function loadManagedLocalConfigValues(
  rootDir: string = process.cwd()
): ManagedLocalConfigValues {
  return serializeManagedLocalValues(
    loadConfigFromSourcesSync({
      schema: managedLocalConfigSourceSchema,
      tomlPath: getLocalConfigPath(rootDir),
    })
  );
}

export function readLocalConfigFile(
  rootDir: string = process.cwd()
): ManagedLocalConfigSource {
  const filePath = getLocalConfigPath(rootDir);
  if (!existsSync(filePath)) {
    return {};
  }

  return readTomlFileSync(filePath) as ManagedLocalConfigSource;
}

export function createLocalProcessEnv(
  rootDir: string = process.cwd(),
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const managedValues = loadManagedLocalConfigValues(rootDir);

  return {
    ...getManagedLocalConfigDefaults(),
    ...managedValues,
    ...baseEnv,
  };
}

export function writeManagedLocalConfigTemplate(
  rootDir: string = process.cwd()
): boolean {
  const filePath = getLocalConfigTemplatePath(rootDir);
  const rendered = renderManagedLocalConfigFile();
  const current = existsSync(filePath) ? readFileSync(filePath, "utf8") : null;

  if (current === rendered) {
    return false;
  }

  writeFileSync(filePath, rendered, "utf8");
  return true;
}

export function syncManagedLocalConfigFile(
  rootDir: string = process.cwd()
): ManagedLocalConfigSyncResult {
  const filePath = getLocalConfigPath(rootDir);
  const seededValues = getManagedLocalSeedValues();

  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, renderManagedLocalConfigFile(seededValues), "utf8");

    return {
      addedKeys: MANAGED_LOCAL_CONFIG_FIELDS.map(
        (definition) => definition.key
      ),
      created: true,
      errors: [],
      missingKeys: [],
      path: filePath,
    };
  }

  const currentContents = readFileSync(filePath, "utf8");
  let parsed: ManagedLocalConfigSource;
  try {
    parsed = readLocalConfigFile(rootDir);
  } catch (error) {
    return {
      addedKeys: [],
      created: false,
      errors: [`Failed to parse ${filePath}: ${error}`],
      missingKeys: [],
      path: filePath,
    };
  }

  const missingDefinitions = MANAGED_LOCAL_CONFIG_FIELDS.filter(
    (definition) => !(definition.key in parsed)
  );

  if (missingDefinitions.length > 0) {
    const missingBlock = [
      "",
      "# Added automatically by OneQuery config sync. Existing values were preserved.",
      ...missingDefinitions.map((definition) =>
        renderManagedLocalConfigLine(
          definition,
          resolveManagedLocalSeedValue(definition)
        )
      ),
      "",
    ].join("\n");

    writeFileSync(
      filePath,
      `${currentContents.trimEnd()}\n${missingBlock}`,
      "utf8"
    );
  }

  const nextValues = readLocalConfigFile(rootDir);
  const validation = validateManagedLocalConfigValues(nextValues);

  return {
    addedKeys: missingDefinitions.map((definition) => definition.key),
    created: false,
    ...validation,
    path: filePath,
  };
}

export function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isDev(): boolean {
  return process.env.NODE_ENV === "development" || !process.env.NODE_ENV;
}

export function isDocker(): boolean {
  try {
    return existsSync("/.dockerenv");
  } catch {
    return false;
  }
}

export function getWebUrl(): string {
  const webUrl = process.env.WEB_URL;
  if (webUrl) {
    return webUrl;
  }

  return isDocker() ? DOCKER_URL : LOCAL_WEB_ORIGIN;
}

export function getAgentUrl(): string {
  return LOCAL_AGENT_ORIGIN;
}
