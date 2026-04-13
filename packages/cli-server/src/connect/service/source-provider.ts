import type { ProviderType } from "@onequery/db/server";

import { throwCliConnectError } from "../error";
import { CliSourceProvider } from "../gen/onequery/cli/v1/source_pb";

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

export function fromCliSourceProvider(value: CliSourceProvider): ProviderType {
  switch (value) {
    case CliSourceProvider.POSTGRES:
      return "postgres";
    case CliSourceProvider.SUPABASE:
      return "supabase";
    case CliSourceProvider.MYSQL:
      return "mysql";
    case CliSourceProvider.MONGODB:
      return "mongodb";
    case CliSourceProvider.BIGQUERY:
      return "bigquery";
    case CliSourceProvider.LAMINAR:
      return "laminar";
    case CliSourceProvider.AWS_ATHENA_CONNECTOR:
      return "aws_athena_connector";
    case CliSourceProvider.GA:
      return "ga";
    case CliSourceProvider.AMPLITUDE:
      return "amplitude";
    case CliSourceProvider.MIXPANEL:
      return "mixpanel";
    case CliSourceProvider.POSTHOG:
      return "posthog";
    case CliSourceProvider.SENTRY:
      return "sentry";
    case CliSourceProvider.GITHUB:
      return "github";
    case CliSourceProvider.LINEAR:
      return "linear";
    default:
      throwCliConnectError({
        detail: "unsupported source provider",
        key: "SOURCE_REQUEST_INVALID",
      });
  }
}
