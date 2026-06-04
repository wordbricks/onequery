export type ComparisonCriterion = {
  alternative: string;
  factor: string;
  oneQuery: string;
};

export type ComparisonFaq = {
  answer: string;
  question: string;
};

export type ComparisonReference = {
  description: string;
  href: string;
  label: string;
};

export type ComparisonContent = {
  alternativeBestFor: readonly string[];
  alternativeName: string;
  answer: string;
  category: string;
  criteria: readonly ComparisonCriterion[];
  eyebrow: string;
  faqs: readonly ComparisonFaq[];
  heroSignals: readonly string[];
  keywords: readonly string[];
  migrationSteps: readonly string[];
  metaDescription: string;
  oneQueryBestFor: readonly string[];
  order: number;
  references: readonly ComparisonReference[];
  summary: string;
  title: string;
};

export type ComparisonPage = ComparisonContent & {
  slug: string;
};
