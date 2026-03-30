import {
  and,
  asc,
  createDb,
  eq,
  getDatabaseSchema,
  or,
} from "@onequery/db/server";
import type {
  ConnectorHealthStatus,
  Database,
  ConnectorAthenaJobOutcome as StoredConnectorAthenaJobOutcome,
  ConnectorMetadata as StoredConnectorMetadata,
} from "@onequery/db/server";

type ConnectorMetadata = StoredConnectorMetadata;

type ConnectorHeartbeatPayload = {
  timestamp: string;
  status: ConnectorHealthStatus;
  metadata?: Record<string, string | number | boolean | null>;
};

type ConnectorAthenaJob = {
  jobId: string;
  type: "athena_query";
  sql: string;
  database: string;
  workgroup?: string;
  timeoutMs?: number;
  maxRows?: number;
};

type ConnectorAthenaJobSuccessPayload = Extract<
  StoredConnectorAthenaJobOutcome,
  { status: "success" }
>;

type ConnectorAthenaJobErrorPayload = Extract<
  StoredConnectorAthenaJobOutcome,
  { status: "error" }
>;

export type ConnectorAthenaJobOutcome = StoredConnectorAthenaJobOutcome;

type ConnectorRecord = {
  connectorId: string;
  authToken: string;
  organizationId: string;
  connectorName: string;
  metadata?: ConnectorMetadata;
  registeredAt: Date;
  lastHeartbeatAt: Date | null;
  lastSeenAt: Date | null;
  healthStatus: ConnectorHeartbeatPayload["status"] | null;
};

type ConnectorJobRecord = {
  jobId: string;
  connectorId: string;
  job: ConnectorAthenaJob;
  status: "queued" | "leased" | "completed" | "expired";
  createdAt: Date;
  leasedAt: Date | null;
  completedAt: Date | null;
  outcome: ConnectorAthenaJobOutcome | null;
};

type ConnectorJobWaiter = {
  resolve: (value: ConnectorAthenaJobOutcome) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type ConnectorStore = {
  connectors: Map<string, ConnectorRecord>;
  jobs: Map<string, ConnectorJobRecord>;
  queues: Map<string, string[]>;
  waiters: Map<string, ConnectorJobWaiter>;
};

const DEFAULT_JOB_POLL_INTERVAL_MS = 200;
const DEFAULT_CONNECTOR_LONG_POLL_TIMEOUT_MS = 25_000;
// Comment: The in-memory broker path is effectively dormant because this
// override is fixed to null in production code; keep auth hardening aligned
// here so tests stay safe if a harness wires it up later.
const testStoreOverride: ConnectorStore | null = null;

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function safeEqualToken(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  const result = leftBytes.reduce(
    (acc, value, index) => acc | (value ^ (rightBytes[index] ?? 0)),
    0
  );
  return result === 0;
}

export class ConnectorBrokerError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ConnectorBrokerError";
    this.status = status;
  }
}

export class ConnectorJobTimeoutError extends ConnectorBrokerError {
  readonly jobId: string;
  readonly timeoutMs: number;

  constructor(input: { jobId: string; timeoutMs: number }) {
    super(
      `Connector job ${input.jobId} timed out after ${input.timeoutMs}ms`,
      504
    );
    this.name = "ConnectorJobTimeoutError";
    this.jobId = input.jobId;
    this.timeoutMs = input.timeoutMs;
  }
}

type ConnectorAuthResult =
  | { ok: true; connector: { connectorId: string; organizationId: string } }
  | { ok: false; status: 401 | 404; error: string };

type ConnectorJobMutateResult =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 404 | 409; error: string };

type ConnectorJobMutationError = Extract<
  ConnectorJobMutateResult,
  { ok: false }
>;

type ConnectorJobRequest = {
  connectorId: string;
  authToken: string;
  jobId: string;
  db?: Database;
};

function getConnectorTables(db: Database) {
  const schema = getDatabaseSchema(db);
  return {
    connectorJobs: schema.connectorJobs,
    connectors: schema.connectors,
  };
}

function getTestStoreOverride(): ConnectorStore | null {
  return testStoreOverride;
}

function readProcessDatabaseUrl(): string | null {
  if (typeof process === "undefined") {
    return null;
  }

  const value = process.env.DATABASE_URL;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function resolveBrokerDb(db: Database | undefined): Database {
  if (db) {
    return db;
  }

  const databaseUrl = readProcessDatabaseUrl();
  if (!databaseUrl) {
    throw new ConnectorBrokerError(
      "Connector broker database is not configured.",
      503
    );
  }

  // Comment: Node callers may omit db and rely on DATABASE_URL, but Worker callers
  // should pass a request-scoped db explicitly so connector state uses the right env.
  return createDb(databaseUrl);
}

async function hashAuthToken(authToken: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(authToken)
  );
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

export function readBearerToken(
  authorizationHeader: string | undefined | null
): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const parts = authorizationHeader.trim().split(/\s+/u);
  if (parts.length !== 2) {
    return null;
  }

  const [scheme, token] = parts;
  if (scheme?.toLowerCase() !== "bearer") {
    return null;
  }

  const normalized = token?.trim() ?? "";
  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    return null;
  }

  return normalized;
}

function generateConnectorId(): string {
  return `connector_${crypto.randomUUID()}`;
}

function generateConnectorAuthToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
}

function generateJobId(): string {
  return `job_${crypto.randomUUID()}`;
}

function buildConnectorJob(input: {
  jobId: string;
  sql: string;
  database: string;
  workgroup?: string;
  timeoutMs?: number;
  maxRows?: number;
}): ConnectorAthenaJob {
  return {
    database: input.database,
    jobId: input.jobId,
    maxRows: input.maxRows,
    sql: input.sql,
    timeoutMs: input.timeoutMs,
    type: "athena_query",
    workgroup: input.workgroup,
  };
}

function settleWaiter(input: {
  jobId: string;
  settle: (waiter: ConnectorJobWaiter) => void;
}): void {
  const store = getTestStoreOverride();
  if (!store) {
    return;
  }

  const waiter = store.waiters.get(input.jobId);
  if (!waiter) {
    return;
  }

  clearTimeout(waiter.timeoutId);
  store.waiters.delete(input.jobId);
  input.settle(waiter);
}

async function createJobWaitPromiseInMemory(input: {
  store: ConnectorStore;
  jobId: string;
  waitTimeoutMs: number;
}): Promise<ConnectorAthenaJobOutcome> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const record = input.store.jobs.get(input.jobId);
      if (record && record.status !== "completed") {
        record.status = "expired";
        record.completedAt = new Date();
      }
      input.store.waiters.delete(input.jobId);
      reject(
        new ConnectorJobTimeoutError({
          jobId: input.jobId,
          timeoutMs: input.waitTimeoutMs,
        })
      );
    }, input.waitTimeoutMs);

    input.store.waiters.set(input.jobId, {
      reject,
      resolve,
      timeoutId,
    });
  });
}

function authenticateConnectorInMemory(input: {
  store: ConnectorStore;
  connectorId: string;
  authToken: string;
}): ConnectorAuthResult {
  const connector = input.store.connectors.get(input.connectorId);
  if (!connector) {
    return { error: "Connector not found", ok: false, status: 404 };
  }

  if (!safeEqualToken(connector.authToken, input.authToken)) {
    return { error: "Invalid connector token", ok: false, status: 401 };
  }

  return {
    connector: {
      connectorId: connector.connectorId,
      organizationId: connector.organizationId,
    },
    ok: true,
  };
}

async function authenticateConnectorInDb(input: {
  db: Database;
  connectorId: string;
  authToken: string;
}): Promise<ConnectorAuthResult> {
  const { connectors } = getConnectorTables(input.db);
  const [connector] = await input.db
    .select({
      authTokenHash: connectors.authTokenHash,
      connectorId: connectors.connectorId,
      organizationId: connectors.organizationId,
    })
    .from(connectors)
    .where(eq(connectors.connectorId, input.connectorId))
    .limit(1);

  if (!connector) {
    return { error: "Connector not found", ok: false, status: 404 };
  }

  const authTokenHash = await hashAuthToken(input.authToken);
  if (connector.authTokenHash !== authTokenHash) {
    return { error: "Invalid connector token", ok: false, status: 401 };
  }

  return {
    connector: {
      connectorId: connector.connectorId,
      organizationId: connector.organizationId,
    },
    ok: true,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepUnlessAborted(input: {
  ms: number;
  signal?: AbortSignal;
}): Promise<boolean> {
  if (input.signal?.aborted) {
    return false;
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const timeoutId = setTimeout(() => {
      finish(true);
    }, input.ms);

    const abortHandler = () => {
      clearTimeout(timeoutId);
      finish(false);
    };

    const cleanup = () => {
      input.signal?.removeEventListener("abort", abortHandler);
    };

    input.signal?.addEventListener("abort", abortHandler, { once: true });
  });
}

async function expireConnectorJobIfPending(input: {
  db: Database;
  jobId: string;
  now: Date;
}): Promise<void> {
  const { connectorJobs } = getConnectorTables(input.db);
  await input.db
    .update(connectorJobs)
    .set({
      completedAt: input.now,
      status: "expired",
      updatedAt: input.now,
    })
    .where(
      and(
        eq(connectorJobs.jobId, input.jobId),
        or(
          eq(connectorJobs.status, "queued"),
          eq(connectorJobs.status, "leased")
        )
      )
    );
}

async function waitForConnectorJobOutcomeInDb(input: {
  db: Database;
  jobId: string;
  waitTimeoutMs: number;
}): Promise<ConnectorAthenaJobOutcome> {
  const { connectorJobs } = getConnectorTables(input.db);
  const startedAt = Date.now();

  while (Date.now() - startedAt <= input.waitTimeoutMs) {
    const [job] = await input.db
      .select({
        outcome: connectorJobs.outcome,
        status: connectorJobs.status,
      })
      .from(connectorJobs)
      .where(eq(connectorJobs.jobId, input.jobId))
      .limit(1);

    if (!job) {
      throw new ConnectorBrokerError("Job not found", 404);
    }

    if (job.status === "completed" && job.outcome) {
      return job.outcome;
    }

    if (job.status === "expired") {
      throw new ConnectorJobTimeoutError({
        jobId: input.jobId,
        timeoutMs: input.waitTimeoutMs,
      });
    }

    const remainingMs = input.waitTimeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      break;
    }

    await sleep(Math.min(DEFAULT_JOB_POLL_INTERVAL_MS, remainingMs));
  }

  await expireConnectorJobIfPending({
    db: input.db,
    jobId: input.jobId,
    now: new Date(),
  });

  const [finalJob] = await input.db
    .select({
      outcome: connectorJobs.outcome,
      status: connectorJobs.status,
    })
    .from(connectorJobs)
    .where(eq(connectorJobs.jobId, input.jobId))
    .limit(1);

  if (finalJob?.status === "completed" && finalJob.outcome) {
    return finalJob.outcome;
  }

  throw new ConnectorJobTimeoutError({
    jobId: input.jobId,
    timeoutMs: input.waitTimeoutMs,
  });
}

async function claimNextQueuedJobInDb(input: {
  db: Database;
  connectorId: string;
  now: Date;
}): Promise<ConnectorAthenaJob | null> {
  const { connectorJobs } = getConnectorTables(input.db);
  while (true) {
    const [candidate] = await input.db
      .select({
        database: connectorJobs.database,
        jobId: connectorJobs.jobId,
        maxRows: connectorJobs.maxRows,
        sql: connectorJobs.sql,
        timeoutMs: connectorJobs.timeoutMs,
        workgroup: connectorJobs.workgroup,
      })
      .from(connectorJobs)
      .where(
        and(
          eq(connectorJobs.connectorId, input.connectorId),
          eq(connectorJobs.status, "queued")
        )
      )
      .orderBy(asc(connectorJobs.createdAt))
      .limit(1);

    if (!candidate) {
      return null;
    }

    const [claimed] = await input.db
      .update(connectorJobs)
      .set({
        leasedAt: input.now,
        status: "leased",
        updatedAt: input.now,
      })
      .where(
        and(
          eq(connectorJobs.jobId, candidate.jobId),
          eq(connectorJobs.status, "queued")
        )
      )
      .returning({
        database: connectorJobs.database,
        jobId: connectorJobs.jobId,
        maxRows: connectorJobs.maxRows,
        sql: connectorJobs.sql,
        timeoutMs: connectorJobs.timeoutMs,
        workgroup: connectorJobs.workgroup,
      });

    if (!claimed) {
      continue;
    }

    return buildConnectorJob({
      database: claimed.database,
      jobId: claimed.jobId,
      maxRows: claimed.maxRows ?? undefined,
      sql: claimed.sql,
      timeoutMs: claimed.timeoutMs ?? undefined,
      workgroup: claimed.workgroup ?? undefined,
    });
  }
}

function assertJobMutationAllowedInMemory(input: {
  store: ConnectorStore;
  request: ConnectorJobRequest;
}): { ok: true; record: ConnectorJobRecord } | ConnectorJobMutationError {
  const auth = authenticateConnectorInMemory({
    authToken: input.request.authToken,
    connectorId: input.request.connectorId,
    store: input.store,
  });
  if (!auth.ok) {
    return auth;
  }

  const record = input.store.jobs.get(input.request.jobId);
  if (!record) {
    return { error: "Job not found", ok: false, status: 404 };
  }

  if (record.connectorId !== input.request.connectorId) {
    return {
      error: "Job does not belong to connector",
      ok: false,
      status: 401,
    };
  }

  if (record.status === "completed" || record.status === "expired") {
    return { error: "Job is already finalized", ok: false, status: 409 };
  }

  return { ok: true, record };
}

async function assertJobMutationAllowedInDb(
  request: ConnectorJobRequest
): Promise<
  | {
      ok: true;
      record: {
        jobId: string;
        connectorId: string;
        status: "queued" | "leased" | "completed" | "expired";
      };
    }
  | ConnectorJobMutationError
> {
  const db = resolveBrokerDb(request.db);
  const { connectorJobs } = getConnectorTables(db);
  const auth = await authenticateConnectorInDb({
    authToken: request.authToken,
    connectorId: request.connectorId,
    db,
  });
  if (!auth.ok) {
    return auth;
  }

  const [record] = await db
    .select({
      connectorId: connectorJobs.connectorId,
      jobId: connectorJobs.jobId,
      status: connectorJobs.status,
    })
    .from(connectorJobs)
    .where(eq(connectorJobs.jobId, request.jobId))
    .limit(1);

  if (!record) {
    return { error: "Job not found", ok: false, status: 404 };
  }

  if (record.connectorId !== request.connectorId) {
    return {
      error: "Job does not belong to connector",
      ok: false,
      status: 401,
    };
  }

  if (record.status === "completed" || record.status === "expired") {
    return { error: "Job is already finalized", ok: false, status: 409 };
  }

  return { ok: true, record };
}

export async function findConnectorIdByAuthToken(input: {
  authToken: string;
  db?: Database;
}): Promise<string | null> {
  const store = getTestStoreOverride();
  if (store) {
    let matchedConnectorId: string | null = null;
    for (const connector of store.connectors.values()) {
      if (safeEqualToken(connector.authToken, input.authToken)) {
        matchedConnectorId = connector.connectorId;
      }
    }
    return matchedConnectorId;
  }

  const db = resolveBrokerDb(input.db);
  const { connectors } = getConnectorTables(db);
  const authTokenHash = await hashAuthToken(input.authToken);
  const [connector] = await db
    .select({ connectorId: connectors.connectorId })
    .from(connectors)
    .where(eq(connectors.authTokenHash, authTokenHash))
    .limit(1);

  return connector?.connectorId ?? null;
}

export async function registerConnector(input: {
  db?: Database;
  organizationId: string;
  connectorName: string;
  metadata?: ConnectorMetadata;
}): Promise<{
  connectorId: string;
  authToken: string;
}> {
  const store = getTestStoreOverride();
  if (store) {
    const connectorId = generateConnectorId();
    const authToken = generateConnectorAuthToken();
    const now = new Date();

    store.connectors.set(connectorId, {
      authToken,
      connectorId,
      connectorName: input.connectorName,
      healthStatus: null,
      lastHeartbeatAt: null,
      lastSeenAt: null,
      metadata: input.metadata,
      organizationId: input.organizationId,
      registeredAt: now,
    });
    store.queues.set(connectorId, []);
    return { authToken, connectorId };
  }

  const db = resolveBrokerDb(input.db);
  const { connectors } = getConnectorTables(db);
  const connectorId = generateConnectorId();
  const authToken = generateConnectorAuthToken();
  const authTokenHash = await hashAuthToken(authToken);
  const now = new Date();

  await db.insert(connectors).values({
    authTokenHash,
    connectorId,
    connectorName: input.connectorName,
    metadata: input.metadata,
    organizationId: input.organizationId,
    registeredAt: now,
    updatedAt: now,
  });

  return { authToken, connectorId };
}

export async function ensureConnectorOrganization(input: {
  db?: Database;
  connectorId: string;
  organizationId: string;
}): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  const store = getTestStoreOverride();
  if (store) {
    const connector = store.connectors.get(input.connectorId);
    if (!connector) {
      return { error: "Connector not found", ok: false, status: 404 };
    }

    if (connector.organizationId !== input.organizationId) {
      return {
        error: "Connector belongs to a different organization",
        ok: false,
        status: 403,
      };
    }

    return { ok: true };
  }

  const db = resolveBrokerDb(input.db);
  const { connectors } = getConnectorTables(db);
  const [connector] = await db
    .select({ organizationId: connectors.organizationId })
    .from(connectors)
    .where(eq(connectors.connectorId, input.connectorId))
    .limit(1);

  if (!connector) {
    return { error: "Connector not found", ok: false, status: 404 };
  }

  if (connector.organizationId !== input.organizationId) {
    return {
      error: "Connector belongs to a different organization",
      ok: false,
      status: 403,
    };
  }

  return { ok: true };
}

export async function recordConnectorHeartbeat(input: {
  db?: Database;
  connectorId: string;
  authToken: string;
  payload: ConnectorHeartbeatPayload;
}): Promise<{ ok: true } | { ok: false; status: 401 | 404; error: string }> {
  const store = getTestStoreOverride();
  if (store) {
    const auth = authenticateConnectorInMemory({
      authToken: input.authToken,
      connectorId: input.connectorId,
      store,
    });
    if (!auth.ok) {
      return auth;
    }

    const connector = store.connectors.get(input.connectorId);
    if (!connector) {
      return { error: "Connector not found", ok: false, status: 404 };
    }

    const now = new Date();
    connector.lastHeartbeatAt = now;
    connector.lastSeenAt = now;
    connector.healthStatus = input.payload.status;
    return { ok: true };
  }

  const db = resolveBrokerDb(input.db);
  const { connectors } = getConnectorTables(db);
  const auth = await authenticateConnectorInDb({
    authToken: input.authToken,
    connectorId: input.connectorId,
    db,
  });
  if (!auth.ok) {
    return auth;
  }

  const now = new Date();
  await db
    .update(connectors)
    .set({
      healthStatus: input.payload.status,
      lastHeartbeatAt: now,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(connectors.connectorId, input.connectorId));
  return { ok: true };
}

export async function pollConnectorJob(input: {
  db?: Database;
  connectorId: string;
  authToken: string;
  waitTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; job: ConnectorAthenaJob | null }
  | { ok: false; status: 401 | 404; error: string }
> {
  const waitTimeoutMs =
    input.waitTimeoutMs ?? DEFAULT_CONNECTOR_LONG_POLL_TIMEOUT_MS;
  const startedAt = Date.now();

  const store = getTestStoreOverride();
  if (store) {
    const auth = authenticateConnectorInMemory({
      authToken: input.authToken,
      connectorId: input.connectorId,
      store,
    });
    if (!auth.ok) {
      return auth;
    }

    let nextJob: ConnectorAthenaJob | null = null;

    while (nextJob === null) {
      const queue = store.queues.get(input.connectorId) ?? [];

      while (queue.length > 0 && nextJob === null) {
        const jobId = queue.shift();
        if (!jobId) {
          continue;
        }

        const record = store.jobs.get(jobId);
        if (!record || record.status !== "queued") {
          continue;
        }

        record.status = "leased";
        record.leasedAt = new Date();
        nextJob = record.job;
      }

      if (nextJob !== null) {
        break;
      }

      const remainingMs = waitTimeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        break;
      }

      const slept = await sleepUnlessAborted({
        ms: Math.min(DEFAULT_JOB_POLL_INTERVAL_MS, remainingMs),
        signal: input.signal,
      });
      if (!slept) {
        break;
      }
    }

    const connector = store.connectors.get(input.connectorId);
    if (connector) {
      connector.lastSeenAt = new Date();
    }
    return { job: nextJob, ok: true };
  }

  const db = resolveBrokerDb(input.db);
  const { connectors } = getConnectorTables(db);
  const auth = await authenticateConnectorInDb({
    authToken: input.authToken,
    connectorId: input.connectorId,
    db,
  });
  if (!auth.ok) {
    return auth;
  }

  let job: ConnectorAthenaJob | null = null;
  let seenAt = new Date();

  while (job === null) {
    seenAt = new Date();
    job = await claimNextQueuedJobInDb({
      connectorId: input.connectorId,
      db,
      now: seenAt,
    });

    if (job !== null) {
      break;
    }

    const remainingMs = waitTimeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) {
      break;
    }

    const slept = await sleepUnlessAborted({
      ms: Math.min(DEFAULT_JOB_POLL_INTERVAL_MS, remainingMs),
      signal: input.signal,
    });
    if (!slept) {
      break;
    }
  }

  await db
    .update(connectors)
    .set({ lastSeenAt: seenAt, updatedAt: seenAt })
    .where(eq(connectors.connectorId, input.connectorId));

  return { job, ok: true };
}

export async function queueConnectorAthenaJob(input: {
  db?: Database;
  organizationId: string;
  connectorId: string;
  sql: string;
  database: string;
  workgroup?: string;
  timeoutMs?: number;
  maxRows?: number;
  waitTimeoutMs: number;
}): Promise<ConnectorAthenaJobOutcome> {
  const store = getTestStoreOverride();
  if (store) {
    const connector = store.connectors.get(input.connectorId);
    if (!connector) {
      throw new ConnectorBrokerError("Connector not found", 404);
    }

    if (connector.organizationId !== input.organizationId) {
      throw new ConnectorBrokerError(
        "Connector belongs to a different organization",
        403
      );
    }

    const queue = store.queues.get(input.connectorId);
    if (!queue) {
      throw new ConnectorBrokerError(
        `Connector "${input.connectorId}" queue is unavailable`,
        503
      );
    }

    const jobId = generateJobId();
    const job = buildConnectorJob({
      database: input.database,
      jobId,
      maxRows: input.maxRows,
      sql: input.sql,
      timeoutMs: input.timeoutMs,
      workgroup: input.workgroup,
    });
    const waitForOutcome = createJobWaitPromiseInMemory({
      jobId,
      store,
      waitTimeoutMs: input.waitTimeoutMs,
    });

    store.jobs.set(jobId, {
      completedAt: null,
      connectorId: input.connectorId,
      createdAt: new Date(),
      job,
      jobId,
      leasedAt: null,
      outcome: null,
      status: "queued",
    });
    queue.push(jobId);
    return waitForOutcome;
  }

  const db = resolveBrokerDb(input.db);
  const organizationCheck = await ensureConnectorOrganization({
    connectorId: input.connectorId,
    db,
    organizationId: input.organizationId,
  });
  if (!organizationCheck.ok) {
    throw new ConnectorBrokerError(
      organizationCheck.error,
      organizationCheck.status
    );
  }

  const now = new Date();
  const { connectorJobs } = getConnectorTables(db);
  const jobId = generateJobId();
  await db.insert(connectorJobs).values({
    connectorId: input.connectorId,
    createdAt: now,
    database: input.database,
    jobId,
    maxRows: input.maxRows,
    sql: input.sql,
    status: "queued",
    timeoutMs: input.timeoutMs,
    updatedAt: now,
    workgroup: input.workgroup,
  });

  return waitForConnectorJobOutcomeInDb({
    db,
    jobId,
    waitTimeoutMs: input.waitTimeoutMs,
  });
}

export async function submitConnectorJobResult(input: {
  db?: Database;
  connectorId: string;
  authToken: string;
  jobId: string;
  payload: ConnectorAthenaJobSuccessPayload;
}): Promise<ConnectorJobMutateResult> {
  if (input.payload.jobId !== input.jobId) {
    return { error: "Job ID mismatch", ok: false, status: 400 };
  }

  const store = getTestStoreOverride();
  if (store) {
    const prepared = assertJobMutationAllowedInMemory({
      request: input,
      store,
    });
    if (!prepared.ok) {
      return prepared;
    }

    prepared.record.status = "completed";
    prepared.record.completedAt = new Date();
    prepared.record.outcome = input.payload;
    settleWaiter({
      jobId: input.jobId,
      settle: (waiter) => waiter.resolve(input.payload),
    });
    return { ok: true };
  }

  const prepared = await assertJobMutationAllowedInDb(input);
  if (!prepared.ok) {
    return prepared;
  }

  const db = resolveBrokerDb(input.db);
  const { connectorJobs } = getConnectorTables(db);
  const now = new Date();
  const [updated] = await db
    .update(connectorJobs)
    .set({
      completedAt: now,
      outcome: input.payload,
      status: "completed",
      updatedAt: now,
    })
    .where(
      and(
        eq(connectorJobs.jobId, input.jobId),
        eq(connectorJobs.status, prepared.record.status)
      )
    )
    .returning({ jobId: connectorJobs.jobId });

  if (!updated) {
    return { error: "Job is already finalized", ok: false, status: 409 };
  }

  return { ok: true };
}

export async function submitConnectorJobError(input: {
  db?: Database;
  connectorId: string;
  authToken: string;
  jobId: string;
  payload: ConnectorAthenaJobErrorPayload;
}): Promise<ConnectorJobMutateResult> {
  if (input.payload.jobId !== input.jobId) {
    return { error: "Job ID mismatch", ok: false, status: 400 };
  }

  const store = getTestStoreOverride();
  if (store) {
    const prepared = assertJobMutationAllowedInMemory({
      request: input,
      store,
    });
    if (!prepared.ok) {
      return prepared;
    }

    prepared.record.status = "completed";
    prepared.record.completedAt = new Date();
    prepared.record.outcome = input.payload;
    settleWaiter({
      jobId: input.jobId,
      settle: (waiter) => waiter.resolve(input.payload),
    });
    return { ok: true };
  }

  const prepared = await assertJobMutationAllowedInDb(input);
  if (!prepared.ok) {
    return prepared;
  }

  const db = resolveBrokerDb(input.db);
  const { connectorJobs } = getConnectorTables(db);
  const now = new Date();
  const [updated] = await db
    .update(connectorJobs)
    .set({
      completedAt: now,
      outcome: input.payload,
      status: "completed",
      updatedAt: now,
    })
    .where(
      and(
        eq(connectorJobs.jobId, input.jobId),
        eq(connectorJobs.status, prepared.record.status)
      )
    )
    .returning({ jobId: connectorJobs.jobId });

  if (!updated) {
    return { error: "Job is already finalized", ok: false, status: 409 };
  }

  return { ok: true };
}
