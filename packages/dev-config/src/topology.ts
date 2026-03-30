import {
  literalConfigAdapter,
  loadConfigFromSourcesSync,
} from "@onequery/config-loader";
import { z } from "zod";

function createHttpOrigin(host: string, port: number): string {
  return `http://${host}:${port}`;
}

export const LOCAL_DEV_LOOPBACK_HOST = "127.0.0.1" as const;

export interface DatabaseUrlOptions {
  database: string;
  host: string;
  password: string;
  port: number;
  user: string;
}

export function createDatabaseUrl(options: DatabaseUrlOptions): string {
  const { database, host, password, port, user } = options;
  return `postgres://${user}:${password}@${host}:${port}/${database}`;
}

const fourDigitPortSchema = z.number().int().min(1000).max(9999);
const nonEmptyStringSchema = z.string().trim().min(1);

export const localDevConfigSchema = z
  .object({
    dockerHost: nonEmptyStringSchema,
    host: nonEmptyStringSchema,
    ports: z.object({
      agent: fourDigitPortSchema,
      postgres: z.object({
        container: fourDigitPortSchema,
        host: fourDigitPortSchema,
      }),
      webApi: fourDigitPortSchema,
      web: fourDigitPortSchema,
    }),
    postgres: z.object({
      database: nonEmptyStringSchema,
      password: nonEmptyStringSchema,
      user: nonEmptyStringSchema,
    }),
  })
  .superRefine((value, context) => {
    const hostPorts: Array<{
      name: string;
      path: Array<string>;
      port: number;
    }> = [
      { name: "web", path: ["ports", "web"], port: value.ports.web },
      { name: "agent", path: ["ports", "agent"], port: value.ports.agent },
      {
        name: "postgres.host",
        path: ["ports", "postgres", "host"],
        port: value.ports.postgres.host,
      },
      {
        name: "webApi",
        path: ["ports", "webApi"],
        port: value.ports.webApi,
      },
    ];
    const seen = new Map<number, string>();

    for (const entry of hostPorts) {
      const existing = seen.get(entry.port);
      if (existing) {
        context.addIssue({
          code: "custom",
          message: `Local dev host ports must be unique. "${entry.name}" conflicts with "${existing}" on ${entry.port}.`,
          path: entry.path,
        });
        continue;
      }

      seen.set(entry.port, entry.name);
    }
  });

export type LocalDevConfig = z.infer<typeof localDevConfigSchema>;

const LOCAL_DEV_DEFAULTS = {
  dockerHost: "host.docker.internal",
  host: "localhost",
  ports: {
    agent: 8788,
    postgres: {
      container: 5432,
      host: 5454,
    },
    webApi: 4547,
    web: 4545,
  },
  postgres: {
    database: "onequery",
    password: "onequery",
    user: "onequery",
  },
} satisfies LocalDevConfig;

export interface LoadLocalDevConfigOptions {
  readonly env?: Record<string, unknown> | object;
}

export function loadLocalDevConfigSync(
  input: LoadLocalDevConfigOptions = {}
): Readonly<LocalDevConfig> {
  return loadConfigFromSourcesSync({
    adapters: [
      literalConfigAdapter({
        data: LOCAL_DEV_DEFAULTS,
        name: "@onequery/dev-config defaults",
      }),
    ],
    env: input.env,
    schema: localDevConfigSchema,
  });
}

export const LOCAL_DEV = loadLocalDevConfigSync();

export const LOCAL_WEB_PORT = LOCAL_DEV.ports.web;
export const LOCAL_WEB_API_DEV_PORT = LOCAL_DEV.ports.webApi;
export const LOCAL_AGENT_PORT = LOCAL_DEV.ports.agent;
export const LOCAL_POSTGRES_HOST_PORT = LOCAL_DEV.ports.postgres.host;
export const LOCAL_POSTGRES_CONTAINER_PORT = LOCAL_DEV.ports.postgres.container;

export const LOCAL_WEB_ORIGIN = createHttpOrigin(
  LOCAL_DEV.host,
  LOCAL_WEB_PORT
);
export const LOCAL_WEB_DOCKER_ORIGIN = createHttpOrigin(
  LOCAL_DEV.dockerHost,
  LOCAL_WEB_PORT
);
export const LOCAL_WEB_API_DEV_ORIGIN = createHttpOrigin(
  LOCAL_DEV_LOOPBACK_HOST,
  LOCAL_WEB_API_DEV_PORT
);
export const LOCAL_AGENT_ORIGIN = createHttpOrigin(
  LOCAL_DEV.host,
  LOCAL_AGENT_PORT
);
export const LOCAL_POSTGRES_PORT_BINDING = `${LOCAL_POSTGRES_HOST_PORT}:${LOCAL_POSTGRES_CONTAINER_PORT}`;

export function createLocalDatabaseUrl(
  options: Partial<DatabaseUrlOptions> = {}
): string {
  return createDatabaseUrl({
    database: options.database ?? LOCAL_DEV.postgres.database,
    host: options.host ?? LOCAL_DEV.host,
    password: options.password ?? LOCAL_DEV.postgres.password,
    port: options.port ?? LOCAL_POSTGRES_HOST_PORT,
    user: options.user ?? LOCAL_DEV.postgres.user,
  });
}

export const LOCAL_DATABASE_URL = createLocalDatabaseUrl();
export const LOCAL_TEST_DATABASE_URL = createLocalDatabaseUrl({
  database: "test",
  password: "test",
  user: "test",
});
