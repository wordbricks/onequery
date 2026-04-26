import {
  and,
  asc,
  connectorJobs,
  connectors,
  eq,
  or,
} from "@onequery/db/server";
import type {
  ConnectorHealthStatus,
  Database,
  ConnectorAthenaJobOutcome as StoredConnectorAthenaJobOutcome,
  ConnectorMetadata as StoredConnectorMetadata,
} from "@onequery/db/server";
import { Result } from "better-result";
import type { Result as ResultType } from "better-result";

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

type ConnectorBrokerStatus = 400 | 401 | 403 | 404 | 409 | 503 | 504;

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
  resolve: (value: ConnectorBrokerResult<ConnectorAthenaJobOutcome>) => void;
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
  readonly status: ConnectorBrokerStatus;

  constructor(message: string, status: ConnectorBrokerStatus) {
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

type ConnectorAuth = {
  connectorId: string;
  organizationId: string;
};

type ConnectorBrokerResult<T> = ResultType<T, ConnectorBrokerError>;

type ConnectorJobRequest = {
  connectorId: string;
  authToken: string;
  jobId: string;
  db?: Database;
};

function getTestStoreOverride(): ConnectorStore | null {
  return testStoreOverride;
}

function resolveBrokerDb(db: Database | undefined): Database {
  if (db) {
    return db;
  }

  throw new ConnectorBrokerError(
    "Connector broker database is not configured.",
    503
  );
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
}): Promise<ConnectorBrokerResult<ConnectorAthenaJobOutcome>> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      const record = input.store.jobs.get(input.jobId);
      if (record && record.status !== "completed") {
        record.status = "expired";
        record.completedAt = new Date();
      }
      input.store.waiters.delete(input.jobId);
      resolve(
        Result.err(
          new ConnectorJobTimeoutError({
            jobId: input.jobId,
            timeoutMs: input.waitTimeoutMs,
          })
        )
      );
    }, input.waitTimeoutMs);

    input.store.waiters.set(input.jobId, {
      resolve,
      timeoutId,
    });
  });
}

function authenticateConnectorInMemory(input: {
  store: ConnectorStore;
  connectorId: string;
  authToken: string;
}): ConnectorBrokerResult<ConnectorAuth> {
  const connector = input.store.connectors.get(input.connectorId);
  if (!connector) {
    return Result.err(new ConnectorBrokerError("Connector not found", 404));
  }

  if (!safeEqualToken(connector.authToken, input.authToken)) {
    return Result.err(new ConnectorBrokerError("Invalid connector token", 401));
  }

  return Result.ok({
    connectorId: connector.connectorId,
    organizationId: connector.organizationId,
  });
}

async function authenticateConnectorInDb(input: {
  db: Database;
  connectorId: string;
  authToken: string;
}): Promise<ConnectorBrokerResult<ConnectorAuth>> {
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
    return Result.err(new ConnectorBrokerError("Connector not found", 404));
  }

  const authTokenHash = await hashAuthToken(input.authToken);
  if (connector.authTokenHash !== authTokenHash) {
    return Result.err(new ConnectorBrokerError("Invalid connector token", 401));
  }

  return Result.ok({
    connectorId: connector.connectorId,
    organizationId: connector.organizationId,
  });
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
}): Promise<ConnectorBrokerResult<ConnectorAthenaJobOutcome>> {
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
      return Result.err(new ConnectorBrokerError("Job not found", 404));
    }

    if (job.status === "completed" && job.outcome) {
      return Result.ok(job.outcome);
    }

    if (job.status === "expired") {
      return Result.err(
        new ConnectorJobTimeoutError({
          jobId: input.jobId,
          timeoutMs: input.waitTimeoutMs,
        })
      );
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
    return Result.ok(finalJob.outcome);
  }

  return Result.err(
    new ConnectorJobTimeoutError({
      jobId: input.jobId,
      timeoutMs: input.waitTimeoutMs,
    })
  );
}

async function claimNextQueuedJobInDb(input: {
  db: Database;
  connectorId: string;
  now: Date;
}): Promise<ConnectorAthenaJob | null> {
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
}): ConnectorBrokerResult<{ record: ConnectorJobRecord }> {
  const auth = authenticateConnectorInMemory({
    authToken: input.request.authToken,
    connectorId: input.request.connectorId,
    store: input.store,
  });
  if (auth.isErr()) {
    return Result.err(auth.error);
  }

  const record = input.store.jobs.get(input.request.jobId);
  if (!record) {
    return Result.err(new ConnectorBrokerError("Job not found", 404));
  }

  if (record.connectorId !== input.request.connectorId) {
    return Result.err(
      new ConnectorBrokerError("Job does not belong to connector", 401)
    );
  }

  if (record.status === "completed" || record.status === "expired") {
    return Result.err(
      new ConnectorBrokerError("Job is already finalized", 409)
    );
  }

  return Result.ok({ record });
}

async function assertJobMutationAllowedInDb(
  request: ConnectorJobRequest
): Promise<
  ConnectorBrokerResult<{
    record: {
      jobId: string;
      connectorId: string;
      status: "queued" | "leased" | "completed" | "expired";
    };
  }>
> {
  const db = resolveBrokerDb(request.db);
  const auth = await authenticateConnectorInDb({
    authToken: request.authToken,
    connectorId: request.connectorId,
    db,
  });
  if (auth.isErr()) {
    return Result.err(auth.error);
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
    return Result.err(new ConnectorBrokerError("Job not found", 404));
  }

  if (record.connectorId !== request.connectorId) {
    return Result.err(
      new ConnectorBrokerError("Job does not belong to connector", 401)
    );
  }

  if (record.status === "completed" || record.status === "expired") {
    return Result.err(
      new ConnectorBrokerError("Job is already finalized", 409)
    );
  }

  return Result.ok({ record });
}

export async function findConnectorIdByAuthToken(input: {
  authToken: string;
  db?: Database;
}): Promise<ConnectorBrokerResult<string>> {
  const store = getTestStoreOverride();
  if (store) {
    let matchedConnectorId: string | null = null;
    for (const connector of store.connectors.values()) {
      if (safeEqualToken(connector.authToken, input.authToken)) {
        matchedConnectorId = connector.connectorId;
      }
    }
    return matchedConnectorId === null
      ? Result.err(new ConnectorBrokerError("Invalid connector token", 401))
      : Result.ok(matchedConnectorId);
  }

  const db = resolveBrokerDb(input.db);
  const authTokenHash = await hashAuthToken(input.authToken);
  const [connector] = await db
    .select({ connectorId: connectors.connectorId })
    .from(connectors)
    .where(eq(connectors.authTokenHash, authTokenHash))
    .limit(1);

  if (!connector?.connectorId) {
    return Result.err(new ConnectorBrokerError("Invalid connector token", 401));
  }

  return Result.ok(connector.connectorId);
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
}): Promise<ConnectorBrokerResult<void>> {
  const store = getTestStoreOverride();
  if (store) {
    const connector = store.connectors.get(input.connectorId);
    if (!connector) {
      return Result.err(new ConnectorBrokerError("Connector not found", 404));
    }

    if (connector.organizationId !== input.organizationId) {
      return Result.err(
        new ConnectorBrokerError(
          "Connector belongs to a different organization",
          403
        )
      );
    }

    return Result.ok(undefined);
  }

  const db = resolveBrokerDb(input.db);
  const [connector] = await db
    .select({ organizationId: connectors.organizationId })
    .from(connectors)
    .where(eq(connectors.connectorId, input.connectorId))
    .limit(1);

  if (!connector) {
    return Result.err(new ConnectorBrokerError("Connector not found", 404));
  }

  if (connector.organizationId !== input.organizationId) {
    return Result.err(
      new ConnectorBrokerError(
        "Connector belongs to a different organization",
        403
      )
    );
  }

  return Result.ok(undefined);
}

export async function recordConnectorHeartbeat(input: {
  db?: Database;
  connectorId: string;
  authToken: string;
  payload: ConnectorHeartbeatPayload;
}): Promise<ConnectorBrokerResult<void>> {
  const store = getTestStoreOverride();
  if (store) {
    const auth = authenticateConnectorInMemory({
      authToken: input.authToken,
      connectorId: input.connectorId,
      store,
    });
    if (auth.isErr()) {
      return Result.err(auth.error);
    }

    const connector = store.connectors.get(input.connectorId);
    if (!connector) {
      return Result.err(new ConnectorBrokerError("Connector not found", 404));
    }

    const now = new Date();
    connector.lastHeartbeatAt = now;
    connector.lastSeenAt = now;
    connector.healthStatus = input.payload.status;
    return Result.ok(undefined);
  }

  const db = resolveBrokerDb(input.db);
  const auth = await authenticateConnectorInDb({
    authToken: input.authToken,
    connectorId: input.connectorId,
    db,
  });
  if (auth.isErr()) {
    return Result.err(auth.error);
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
  return Result.ok(undefined);
}

export async function pollConnectorJob(input: {
  db?: Database;
  connectorId: string;
  authToken: string;
  waitTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<ConnectorBrokerResult<ConnectorAthenaJob | null>> {
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
    if (auth.isErr()) {
      return Result.err(auth.error);
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
    return Result.ok(nextJob);
  }

  const db = resolveBrokerDb(input.db);
  const auth = await authenticateConnectorInDb({
    authToken: input.authToken,
    connectorId: input.connectorId,
    db,
  });
  if (auth.isErr()) {
    return Result.err(auth.error);
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

  return Result.ok(job);
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
}): Promise<ConnectorBrokerResult<ConnectorAthenaJobOutcome>> {
  const store = getTestStoreOverride();
  if (store) {
    const connector = store.connectors.get(input.connectorId);
    if (!connector) {
      return Result.err(new ConnectorBrokerError("Connector not found", 404));
    }

    if (connector.organizationId !== input.organizationId) {
      return Result.err(
        new ConnectorBrokerError(
          "Connector belongs to a different organization",
          403
        )
      );
    }

    const queue = store.queues.get(input.connectorId);
    if (!queue) {
      return Result.err(
        new ConnectorBrokerError(
          `Connector "${input.connectorId}" queue is unavailable`,
          503
        )
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
  if (organizationCheck.isErr()) {
    return Result.err(organizationCheck.error);
  }

  const now = new Date();
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
}): Promise<ConnectorBrokerResult<void>> {
  if (input.payload.jobId !== input.jobId) {
    return Result.err(new ConnectorBrokerError("Job ID mismatch", 400));
  }

  const store = getTestStoreOverride();
  if (store) {
    const prepared = assertJobMutationAllowedInMemory({
      request: input,
      store,
    });
    if (prepared.isErr()) {
      return Result.err(prepared.error);
    }

    prepared.value.record.status = "completed";
    prepared.value.record.completedAt = new Date();
    prepared.value.record.outcome = input.payload;
    settleWaiter({
      jobId: input.jobId,
      settle: (waiter) => waiter.resolve(Result.ok(input.payload)),
    });
    return Result.ok(undefined);
  }

  const prepared = await assertJobMutationAllowedInDb(input);
  if (prepared.isErr()) {
    return Result.err(prepared.error);
  }

  const db = resolveBrokerDb(input.db);
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
        eq(connectorJobs.status, prepared.value.record.status)
      )
    )
    .returning({ jobId: connectorJobs.jobId });

  if (!updated) {
    return Result.err(
      new ConnectorBrokerError("Job is already finalized", 409)
    );
  }

  return Result.ok(undefined);
}

export async function submitConnectorJobError(input: {
  db?: Database;
  connectorId: string;
  authToken: string;
  jobId: string;
  payload: ConnectorAthenaJobErrorPayload;
}): Promise<ConnectorBrokerResult<void>> {
  if (input.payload.jobId !== input.jobId) {
    return Result.err(new ConnectorBrokerError("Job ID mismatch", 400));
  }

  const store = getTestStoreOverride();
  if (store) {
    const prepared = assertJobMutationAllowedInMemory({
      request: input,
      store,
    });
    if (prepared.isErr()) {
      return Result.err(prepared.error);
    }

    prepared.value.record.status = "completed";
    prepared.value.record.completedAt = new Date();
    prepared.value.record.outcome = input.payload;
    settleWaiter({
      jobId: input.jobId,
      settle: (waiter) => waiter.resolve(Result.ok(input.payload)),
    });
    return Result.ok(undefined);
  }

  const prepared = await assertJobMutationAllowedInDb(input);
  if (prepared.isErr()) {
    return Result.err(prepared.error);
  }

  const db = resolveBrokerDb(input.db);
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
        eq(connectorJobs.status, prepared.value.record.status)
      )
    )
    .returning({ jobId: connectorJobs.jobId });

  if (!updated) {
    return Result.err(
      new ConnectorBrokerError("Job is already finalized", 409)
    );
  }

  return Result.ok(undefined);
}
