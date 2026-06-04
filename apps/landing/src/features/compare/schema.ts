import { z } from "astro/zod";

const comparisonCriterionSchema = z.object({
  alternative: z.string().min(1),
  factor: z.string().min(1),
  oneQuery: z.string().min(1),
});

const comparisonFaqSchema = z.object({
  answer: z.string().min(1),
  question: z.string().min(1),
});

const comparisonReferenceSchema = z.object({
  description: z.string().min(1),
  href: z.string().min(1),
  label: z.string().min(1),
});

export function createComparisonContentSchema() {
  return z.object({
    alternativeBestFor: z.array(z.string().min(1)).min(1),
    alternativeName: z.string().min(1),
    answer: z.string().min(1),
    category: z.string().min(1),
    criteria: z.array(comparisonCriterionSchema).min(1),
    eyebrow: z.string().min(1),
    faqs: z.array(comparisonFaqSchema).min(1),
    heroSignals: z.array(z.string().min(1)).min(1),
    keywords: z.array(z.string().min(1)).min(1),
    migrationSteps: z.array(z.string().min(1)).min(1),
    metaDescription: z.string().min(1).max(160),
    oneQueryBestFor: z.array(z.string().min(1)).min(1),
    order: z.number().int().positive(),
    references: z.array(comparisonReferenceSchema).min(1),
    summary: z.string().min(1),
    title: z.string().min(1),
  });
}
