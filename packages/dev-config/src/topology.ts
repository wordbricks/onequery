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
      webDev: fourDigitPortSchema,
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
      { name: "webDev", path: ["ports", "webDev"], port: value.ports.webDev },
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
    webDev: 5515,
    web: 4615,
  },
  postgres: {
    database: "onequery",
    password: "onequery",
    user: "onequery",
  },
} satisfies LocalDevConfig;

export const LOCAL_DEV = localDevConfigSchema.parse(LOCAL_DEV_DEFAULTS);

// Comment: Treat this object as the local topology SSoT. Other packages should
// derive ports and origins from here instead of re-encoding literals.
export const LOCAL_TOPOLOGY = {
  agent: {
    origin: createHttpOrigin(LOCAL_DEV.host, LOCAL_DEV.ports.agent),
    port: LOCAL_DEV.ports.agent,
  },
  dockerHost: LOCAL_DEV.dockerHost,
  host: LOCAL_DEV.host,
  loopbackHost: LOCAL_DEV_LOOPBACK_HOST,
  postgres: {
    containerPort: LOCAL_DEV.ports.postgres.container,
    hostPort: LOCAL_DEV.ports.postgres.host,
    portBinding: `${LOCAL_DEV.ports.postgres.host}:${LOCAL_DEV.ports.postgres.container}`,
  },
  web: {
    api: {
      origin: createHttpOrigin(LOCAL_DEV_LOOPBACK_HOST, LOCAL_DEV.ports.webApi),
      port: LOCAL_DEV.ports.webApi,
    },
    bundled: {
      dockerOrigin: createHttpOrigin(LOCAL_DEV.dockerHost, LOCAL_DEV.ports.web),
      loopbackOrigin: createHttpOrigin(
        LOCAL_DEV_LOOPBACK_HOST,
        LOCAL_DEV.ports.web
      ),
      origin: createHttpOrigin(LOCAL_DEV.host, LOCAL_DEV.ports.web),
      port: LOCAL_DEV.ports.web,
    },
    devBrowser: {
      origin: createHttpOrigin(LOCAL_DEV.host, LOCAL_DEV.ports.webDev),
      port: LOCAL_DEV.ports.webDev,
    },
  },
} as const;

export function createLocalDatabaseUrl(
  options: Partial<DatabaseUrlOptions> = {}
): string {
  return createDatabaseUrl({
    database: options.database ?? LOCAL_DEV.postgres.database,
    host: options.host ?? LOCAL_DEV.host,
    password: options.password ?? LOCAL_DEV.postgres.password,
    port: options.port ?? LOCAL_TOPOLOGY.postgres.hostPort,
    user: options.user ?? LOCAL_DEV.postgres.user,
  });
}

export const LOCAL_DATABASE_URL = createLocalDatabaseUrl();
export const LOCAL_TEST_DATABASE_URL = createLocalDatabaseUrl({
  database: "test",
  password: "test",
  user: "test",
});
