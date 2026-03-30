import { existsSync } from "node:fs";

import type { ZodObject } from "zod";
import type { SyncAdapter } from "zod-config";
import { loadConfigSync } from "zod-config";
import { envAdapter } from "zod-config/env-adapter";
import { tomlAdapter } from "zod-config/toml-adapter";

// Comment: this module is Node-only because zod-config's TOML loader and
// existence checks touch the filesystem.
export interface LoadConfigFromSourcesOptions<Schema extends ZodObject> {
  readonly adapters?: readonly SyncAdapter[];
  readonly env?: Record<string, unknown> | object;
  readonly schema: Schema;
  readonly tomlPath?: string;
}

export interface LiteralConfigAdapterOptions {
  readonly data: Record<string, unknown>;
  readonly name: string;
}

export function literalConfigAdapter({
  data,
  name,
}: LiteralConfigAdapterOptions): SyncAdapter {
  return {
    name,
    read: () => data,
  };
}

export function loadConfigFromSourcesSync<Schema extends ZodObject>(
  input: LoadConfigFromSourcesOptions<Schema>
): Readonly<Schema["_output"]> {
  const adapters: SyncAdapter[] = [...(input.adapters ?? [])];

  if (input.tomlPath && existsSync(input.tomlPath)) {
    adapters.push(tomlAdapter({ path: input.tomlPath }));
  }

  if (input.env) {
    adapters.push(
      envAdapter({ customEnv: input.env as Record<string, unknown> })
    );
  }

  const config =
    adapters.length > 0
      ? loadConfigSync({
          adapters,
          schema: input.schema,
        })
      : loadConfigSync({
          schema: input.schema,
        });

  return Object.freeze(config) as Readonly<Schema["_output"]>;
}
