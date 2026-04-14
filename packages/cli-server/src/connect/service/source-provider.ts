import type { ProviderType } from "@onequery/db/server";
import { Result } from "better-result";

import { CliSourceProvider } from "../gen/onequery/cli/v1/source_pb";
import type { CliServiceResult } from "./result";
import { cliServiceErr } from "./result";

export function toCliSourceProvider(value: ProviderType): CliSourceProvider {
  switch (value) {
    case "postgres":
      return CliSourceProvider.POSTGRES;
    case "supabase":
      return CliSourceProvider.SUPABASE;
    case "mysql":
      return CliSourceProvider.MYSQL;
    case "mongodb":
      return CliSourceProvider.MONGODB;
    case "bigquery":
      return CliSourceProvider.BIGQUERY;
    case "laminar":
      return CliSourceProvider.LAMINAR;
    case "aws_athena_connector":
      return CliSourceProvider.AWS_ATHENA_CONNECTOR;
    case "ga":
      return CliSourceProvider.GA;
    case "amplitude":
      return CliSourceProvider.AMPLITUDE;
    case "mixpanel":
      return CliSourceProvider.MIXPANEL;
    case "posthog":
      return CliSourceProvider.POSTHOG;
    case "sentry":
      return CliSourceProvider.SENTRY;
    case "github":
      return CliSourceProvider.GITHUB;
    case "linear":
      return CliSourceProvider.LINEAR;
  }
}

export function fromCliSourceProvider(
  value: CliSourceProvider
): CliServiceResult<ProviderType> {
  switch (value) {
    case CliSourceProvider.POSTGRES:
      return Result.ok("postgres");
    case CliSourceProvider.SUPABASE:
      return Result.ok("supabase");
    case CliSourceProvider.MYSQL:
      return Result.ok("mysql");
    case CliSourceProvider.MONGODB:
      return Result.ok("mongodb");
    case CliSourceProvider.BIGQUERY:
      return Result.ok("bigquery");
    case CliSourceProvider.LAMINAR:
      return Result.ok("laminar");
    case CliSourceProvider.AWS_ATHENA_CONNECTOR:
      return Result.ok("aws_athena_connector");
    case CliSourceProvider.GA:
      return Result.ok("ga");
    case CliSourceProvider.AMPLITUDE:
      return Result.ok("amplitude");
    case CliSourceProvider.MIXPANEL:
      return Result.ok("mixpanel");
    case CliSourceProvider.POSTHOG:
      return Result.ok("posthog");
    case CliSourceProvider.SENTRY:
      return Result.ok("sentry");
    case CliSourceProvider.GITHUB:
      return Result.ok("github");
    case CliSourceProvider.LINEAR:
      return Result.ok("linear");
    default:
      return cliServiceErr({
        detail: "unsupported source provider",
        key: "SOURCE_REQUEST_INVALID",
      });
  }
}
