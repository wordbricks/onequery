import type { PostgresCredentials } from "@onequery/query";

type SslMode = PostgresCredentials["sslMode"];

export type PostgresSslConfig = false | { rejectUnauthorized: boolean };

type PostgresTransportState =
  | { kind: "plaintext" }
  | { kind: "tls"; verifyServerCertificate: boolean };

type PostgresFailureTransition = {
  nextState: PostgresTransportState;
  preservePriorErrorOnFailure: boolean;
};

export type PostgresClientConfig = {
  connectionTimeoutMillis: number;
  database: string;
  host: string;
  options: string;
  password: string;
  port: number;
  ssl: PostgresSslConfig;
  user: string;
};

const TLS_VERIFICATION_ERRORS = [
  "self-signed certificate",
  "self signed certificate",
  "unable to verify the first certificate",
  "unable to get local issuer certificate",
  "hostname/ip does not match certificate's altnames",
  "certificate has expired",
  "certificate is not yet valid",
];

const TLS_VERIFICATION_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

export function resolveInitialPostgresTransportState(
  sslMode: SslMode
): PostgresTransportState {
  if (sslMode === "disable") {
    return { kind: "plaintext" };
  }

  if (sslMode === "require") {
    // Comment: PostgreSQL `sslmode=require` means "use TLS" rather than
    // "validate the server certificate chain". If we need `verify-ca` or
    // `verify-full`, that belongs in the credential schema as explicit modes.
    return { kind: "tls", verifyServerCertificate: false };
  }

  return { kind: "tls", verifyServerCertificate: true };
}

export function resolvePostgresFailureTransitions(
  sslMode: SslMode,
  error: unknown
): PostgresFailureTransition[] {
  if (sslMode !== "prefer") {
    return [];
  }

  if (!isTlsVerificationError(error)) {
    return [
      {
        nextState: { kind: "plaintext" },
        preservePriorErrorOnFailure: true,
      },
    ];
  }

  return [
    {
      nextState: { kind: "tls", verifyServerCertificate: false },
      preservePriorErrorOnFailure: false,
    },
    {
      nextState: { kind: "plaintext" },
      preservePriorErrorOnFailure: true,
    },
  ];
}

export function buildPostgresClientConfig(
  creds: PostgresCredentials,
  state: PostgresTransportState,
  timeoutMs: number
): PostgresClientConfig {
  return {
    connectionTimeoutMillis: timeoutMs,
    database: creds.database,
    host: creds.host,
    options: `-c statement_timeout=${timeoutMs} -c default_transaction_read_only=on`,
    password: creds.password,
    port: creds.port,
    ssl: buildPostgresSslConfig(state),
    user: creds.username,
  };
}

export function isTlsVerificationError(error: unknown): boolean {
  const code = readErrorCode(error);
  if (code && TLS_VERIFICATION_ERROR_CODES.has(code)) {
    return true;
  }

  const message = toErrorMessage(error).toLowerCase();
  return TLS_VERIFICATION_ERRORS.some((fragment) => message.includes(fragment));
}

function buildPostgresSslConfig(
  state: PostgresTransportState
): PostgresSslConfig {
  if (state.kind === "plaintext") {
    return false;
  }

  return { rejectUnauthorized: state.verifyServerCertificate };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function readErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return null;
}
