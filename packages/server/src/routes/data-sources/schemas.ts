import { CredentialsSchema } from "@onequery/db/server";
import { z } from "zod";

export const OrgQuerySchema = z.object({
  organizationId: z.string().min(1, "organizationId is required"),
});

export const CredentialsByNameQuerySchema = z.object({
  name: z.string().min(1, "data source name is required"),
  organizationId: z.string().min(1, "organizationId is required"),
});

export const CreateDataSourceSchema = z.object({
  credentials: CredentialsSchema,
  name: z.string().min(1),
  organizationId: z.string().min(1),
  provider: z.enum([
    "postgres",
    "supabase",
    "mysql",
    "mongodb",
    "ga",
    "bigquery",
    "laminar",
    "aws_athena_connector",
    "amplitude",
    "mixpanel",
    "posthog",
    "sentry",
    "github",
    "linear",
  ]),
});

export const UpdateDataSourceSchema = z.object({
  credentials: CredentialsSchema.optional(),
  name: z.string().min(1).optional(),
  useAsDataSource: z.boolean().optional(),
});
