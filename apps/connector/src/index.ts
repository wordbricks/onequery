import { ZodError } from "zod";

import { AthenaExecutor } from "./aws/athena";
import { ensureGlueDatabaseAccessible, GlueAccessError } from "./aws/glue";
import { loadConfig } from "./config";
import { runAthenaJob } from "./jobs/runner";
import { createLogger } from "./logger";
import { OneQueryClient, OneQueryHttpError } from "./onequery-client";
import type { ConnectorSession } from "./types";
import { sleep, toErrorMessage } from "./utils";

if (import.meta.main) {
  void startConnector();
}

export async function startConnector(): Promise<void> {
  let session: ConnectorSession | null = null;

  try {
    const config = loadConfig();
    const abortOnPrereqFailure = parseBooleanEnv(
      process.env.CONNECTOR_ABORT_ON_PREREQ_FAILURE,
      true
    );
    const abortOnAuthFailure = parseBooleanEnv(
      process.env.CONNECTOR_ABORT_ON_AUTH_FAILURE,
      true
    );
    const logger = createLogger(config.logLevel);
    const onequeryClient = new OneQueryClient({
      baseUrl: config.onequeryBaseUrl,
      logger,
    });
    const athena = new AthenaExecutor({
      defaultDatabase: config.athenaDatabase,
      defaultWorkgroup: config.athenaWorkgroup,
      maxPayloadBytes: config.maxPayloadBytes,
      maxRows: config.maxRows,
      outputLocation: config.athenaOutputLocation,
      queryTimeoutMs: config.queryTimeoutMs,
      region: config.awsRegion,
    });

    logger.info("connector.startup", {
      abortOnAuthFailure,
      abortOnPrereqFailure,
      connectorName: config.connectorName,
      hasExtraCaCerts: Boolean(config.nodeExtraCaCerts),
      hasHttpsProxy: Boolean(config.httpsProxy),
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      maxPayloadBytes: config.maxPayloadBytes,
      maxRows: config.maxRows,
      pollIntervalMs: config.pollIntervalMs,
      queryTimeoutMs: config.queryTimeoutMs,
      region: config.awsRegion,
    });

    let glueValidationAttempt = 0;
    while (true) {
      glueValidationAttempt += 1;
      try {
        await ensureGlueDatabaseAccessible({
          database: config.athenaDatabase,
          region: config.awsRegion,
        });
        logger.info("connector.glue.validation_succeeded", {
          attempt: glueValidationAttempt,
          database: config.athenaDatabase,
        });
        break;
      } catch (error) {
        if (error instanceof GlueAccessError) {
          logger.warn("connector.glue.validation_failed", {
            attempt: glueValidationAttempt,
            code: error.code,
            message: error.message,
          });

          if (abortOnPrereqFailure) {
            process.exit(1);
          }

          const delayMs = Math.min(
            30_000,
            1000 * 2 ** Math.min(glueValidationAttempt, 5)
          );
          await sleep(delayMs);
          continue;
        }

        throw error;
      }
    }

    session = await registerWithRetry({
      abortOnAuthFailure,
      awsRegion: config.awsRegion,
      connectorName: config.connectorName,
      enrollmentToken: config.enrollmentToken,
      logger,
      organizationId: config.organizationId,
      onequeryClient,
    });

    let heartbeatInFlight = false;
    const heartbeatTimer = setInterval(() => {
      if (heartbeatInFlight || session === null) {
        return;
      }

      heartbeatInFlight = true;
      onequeryClient
        .heartbeat({
          payload: {
            timestamp: new Date().toISOString(),
            status: "healthy",
            metadata: {
              athenaDatabase: config.athenaDatabase,
              athenaWorkgroup: config.athenaWorkgroup,
            },
          },
          session,
        })
        .then(() => {
          logger.debug("connector.heartbeat.succeeded", {
            connectorId: session?.connectorId,
          });
        })
        .catch((error) => {
          logger.warn("connector.heartbeat.failed", {
            message: toErrorMessage(error),
          });
          if (isAuthFailure(error)) {
            session = null;
          }
        })
        .finally(() => {
          heartbeatInFlight = false;
        });
    }, config.heartbeatIntervalMs);

    const stop = () => {
      clearInterval(heartbeatTimer);
      logger.info("connector.shutdown");
      process.exit(0);
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    while (true) {
      if (session === null) {
        session = await registerWithRetry({
          abortOnAuthFailure,
          awsRegion: config.awsRegion,
          connectorName: config.connectorName,
          enrollmentToken: config.enrollmentToken,
          logger,
          organizationId: config.organizationId,
          onequeryClient,
        });
      }

      try {
        const job = await onequeryClient.pollNextJob({ session });
        if (job === null) {
          logger.debug("connector.poll.idle", {
            connectorId: session.connectorId,
          });
          continue;
        }

        logger.info("connector.job.received", {
          jobId: job.jobId,
          type: job.type,
        });

        const outcome = await runAthenaJob({
          athena,
          job,
          logger,
        });

        if (outcome.status === "success") {
          await onequeryClient.submitResult({
            payload: outcome,
            session,
          });
          logger.info("connector.job.result_submitted", {
            jobId: outcome.jobId,
            rowCount: outcome.rows.length,
            status: outcome.status,
          });
        } else {
          await onequeryClient.submitError({
            payload: outcome,
            session,
          });
          logger.warn("connector.job.error_submitted", {
            code: outcome.error.code,
            jobId: outcome.jobId,
          });
        }
      } catch (error) {
        if (isAuthFailure(error)) {
          logger.warn("connector.auth.expired", {
            message: toErrorMessage(error),
          });
          session = null;
          continue;
        }

        logger.error("connector.poll.failed", {
          message: toErrorMessage(error),
        });
        // Comment: with long polling enabled, pollIntervalMs is now an error backoff,
        // not the steady-state idle cadence between successful polls.
        await sleep(config.pollIntervalMs);
      }
    }
  } catch (error) {
    if (error instanceof ZodError) {
      console.error(
        JSON.stringify({
          event: "connector.configuration.invalid",
          issues: error.issues.map((issue) => issue.message),
          level: "error",
          timestamp: new Date().toISOString(),
        })
      );
      process.exit(1);
    }

    console.error(
      JSON.stringify({
        connectorId: session?.connectorId,
        event: "connector.unhandled_error",
        level: "error",
        message: toErrorMessage(error),
        timestamp: new Date().toISOString(),
      })
    );
    process.exit(1);
  }
}

export async function registerWithRetry(input: {
  onequeryClient: OneQueryClient;
  organizationId: string;
  connectorName: string;
  enrollmentToken: string;
  awsRegion: string;
  logger: ReturnType<typeof createLogger>;
  abortOnAuthFailure?: boolean;
}): Promise<ConnectorSession> {
  const shouldAbortOnAuthFailure = input.abortOnAuthFailure ?? true;

  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      const session = await input.onequeryClient.register({
        awsRegion: input.awsRegion,
        connectorName: input.connectorName,
        enrollmentToken: input.enrollmentToken,
        organizationId: input.organizationId,
      });

      input.logger.info("connector.registration.succeeded", {
        attempt,
        connectorId: session.connectorId,
      });
      return session;
    } catch (error) {
      if (error instanceof OneQueryHttpError) {
        input.logger.warn("connector.registration.failed", {
          attempt,
          message: error.message,
          status: error.status,
        });

        if (
          (error.status === 401 || error.status === 403) &&
          shouldAbortOnAuthFailure
        ) {
          throw new Error(
            "Connector registration rejected. Check ONEQUERY_ENROLLMENT_TOKEN.",
            { cause: error }
          );
        }
      } else {
        input.logger.warn("connector.registration.failed", {
          attempt,
          message: toErrorMessage(error),
        });
      }

      const delayMs = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
      await sleep(delayMs);
    }
  }
}

function parseBooleanEnv(
  value: string | undefined,
  defaultValue: boolean
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }

  return defaultValue;
}

export function isAuthFailure(error: unknown): boolean {
  if (!(error instanceof OneQueryHttpError)) {
    return false;
  }

  return error.status === 401 || error.status === 403;
}
