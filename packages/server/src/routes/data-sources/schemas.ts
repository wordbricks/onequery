import { z } from "zod";

export const OrgQuerySchema = z.object({
  organizationId: z.string().min(1, "organizationId is required"),
});

export const CredentialsByNameQuerySchema = z.object({
  name: z.string().min(1, "data source name is required"),
  organizationId: z.string().min(1, "organizationId is required"),
});

export const CreateDataSourceSchema = z.object({
  credentials: z.unknown(),
  name: z.string().min(1),
  organizationId: z.string().min(1),
  provider: z.string().min(1),
});

export const UpdateDataSourceSchema = z.object({
  credentials: z.unknown().optional(),
  name: z.string().min(1).optional(),
});
