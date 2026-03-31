import { describe, expect, it } from "vitest";

import {
  createDatabaseUrl,
  createLocalDatabaseUrl,
  LOCAL_DEV,
  LOCAL_TOPOLOGY,
  localDevConfigSchema,
} from "./topology";

describe("topology", () => {
  it("builds database URLs from explicit options", () => {
    expect(
      createDatabaseUrl({
        database: "analytics",
        host: "db.internal",
        password: "secret",
        port: 5433,
        user: "onequery",
      })
    ).toBe("postgres://onequery:secret@db.internal:5433/analytics");
  });

  it("uses local defaults when building local database URLs", () => {
    expect(createLocalDatabaseUrl()).toBe(
      `postgres://${LOCAL_DEV.postgres.user}:${LOCAL_DEV.postgres.password}@${LOCAL_DEV.host}:${LOCAL_DEV.ports.postgres.host}/${LOCAL_DEV.postgres.database}`
    );
    expect(LOCAL_TOPOLOGY.web.bundled.port).toBe(LOCAL_DEV.ports.web);
    expect(LOCAL_TOPOLOGY.web.bundled.origin).toBe(
      `http://${LOCAL_DEV.host}:${LOCAL_DEV.ports.web}`
    );
    expect(LOCAL_TOPOLOGY.web.bundled.loopbackOrigin).toBe(
      `http://${LOCAL_TOPOLOGY.loopbackHost}:${LOCAL_DEV.ports.web}`
    );
    expect(LOCAL_TOPOLOGY.web.devBrowser.port).toBe(LOCAL_DEV.ports.webDev);
    expect(LOCAL_TOPOLOGY.web.devBrowser.origin).toBe(
      `http://${LOCAL_DEV.host}:${LOCAL_DEV.ports.webDev}`
    );
    expect(LOCAL_TOPOLOGY.web.api.port).toBe(LOCAL_DEV.ports.webApi);
    expect(LOCAL_TOPOLOGY.web.api.origin).toBe(
      `http://${LOCAL_TOPOLOGY.loopbackHost}:${LOCAL_DEV.ports.webApi}`
    );
    expect(LOCAL_TOPOLOGY.postgres.portBinding).toBe(
      `${LOCAL_DEV.ports.postgres.host}:${LOCAL_DEV.ports.postgres.container}`
    );

    expect(
      createLocalDatabaseUrl({
        database: "warehouse",
        host: "db.internal",
        password: "secret",
        port: 6432,
        user: "readonly",
      })
    ).toBe("postgres://readonly:secret@db.internal:6432/warehouse");
  });

  it("rejects duplicate host ports in local dev config", () => {
    const parsed = localDevConfigSchema.safeParse({
      ...LOCAL_DEV,
      ports: {
        ...LOCAL_DEV.ports,
        agent: LOCAL_DEV.ports.web,
      },
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining(
            'Local dev host ports must be unique. "agent" conflicts with "web"'
          ),
          path: ["ports", "agent"],
        }),
      ])
    );
  });

  it("rejects a web api dev port that collides with the public web port", () => {
    const parsed = localDevConfigSchema.safeParse({
      ...LOCAL_DEV,
      ports: {
        ...LOCAL_DEV.ports,
        webApi: LOCAL_DEV.ports.web,
      },
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining(
            'Local dev host ports must be unique. "webApi" conflicts with "web"'
          ),
          path: ["ports", "webApi"],
        }),
      ])
    );
  });

  it("rejects a dedicated web dev port that collides with the bundled web port", () => {
    const parsed = localDevConfigSchema.safeParse({
      ...LOCAL_DEV,
      ports: {
        ...LOCAL_DEV.ports,
        webDev: LOCAL_DEV.ports.web,
      },
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining(
            'Local dev host ports must be unique. "webDev" conflicts with "web"'
          ),
          path: ["ports", "webDev"],
        }),
      ])
    );
  });
});
