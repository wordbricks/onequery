import type { ProviderType } from "@onequery/db/server";
import { Result } from "better-result";

import { SourceProvider } from "../gen/onequery/cli/v1/source_pb";
import type { CliServiceResult } from "./result";
import { cliServiceErr } from "./result";

export function toCliSourceProvider(value: ProviderType): SourceProvider {
  switch (value) {
    case "postgres":
      return SourceProvider.POSTGRES;
    case "supabase":
      return SourceProvider.SUPABASE;
    case "mysql":
      return SourceProvider.MYSQL;
    case "mongodb":
      return SourceProvider.MONGODB;
    case "bigquery":
      return SourceProvider.BIGQUERY;
    case "laminar":
      return SourceProvider.LAMINAR;
    case "aws_athena_connector":
      return SourceProvider.AWS_ATHENA_CONNECTOR;
    case "ga":
      return SourceProvider.GA;
    case "amplitude":
      return SourceProvider.AMPLITUDE;
    case "mixpanel":
      return SourceProvider.MIXPANEL;
    case "posthog":
      return SourceProvider.POSTHOG;
    case "sentry":
      return SourceProvider.SENTRY;
    case "github":
      return SourceProvider.GITHUB;
    case "linear":
      return SourceProvider.LINEAR;
  }
}

export function fromCliSourceProvider(
  value: SourceProvider
): CliServiceResult<ProviderType> {
  switch (value) {
    case SourceProvider.POSTGRES:
      return Result.ok("postgres");
    case SourceProvider.SUPABASE:
      return Result.ok("supabase");
    case SourceProvider.MYSQL:
      return Result.ok("mysql");
    case SourceProvider.MONGODB:
      return Result.ok("mongodb");
    case SourceProvider.BIGQUERY:
      return Result.ok("bigquery");
    case SourceProvider.LAMINAR:
      return Result.ok("laminar");
    case SourceProvider.AWS_ATHENA_CONNECTOR:
      return Result.ok("aws_athena_connector");
    case SourceProvider.GA:
      return Result.ok("ga");
    case SourceProvider.AMPLITUDE:
      return Result.ok("amplitude");
    case SourceProvider.MIXPANEL:
      return Result.ok("mixpanel");
    case SourceProvider.POSTHOG:
      return Result.ok("posthog");
    case SourceProvider.SENTRY:
      return Result.ok("sentry");
    case SourceProvider.GITHUB:
      return Result.ok("github");
    case SourceProvider.LINEAR:
      return Result.ok("linear");
    default:
      return cliServiceErr({
        detail: "unsupported source provider",
        key: "SOURCE_REQUEST_INVALID",
      });
  }
}
