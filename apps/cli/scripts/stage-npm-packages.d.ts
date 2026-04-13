export function parseArgs(argv: string[]): {
  outputDir: string;
  packages: string[];
  releaseVersion: string | null;
  vendorSrc: string | null;
};

export function expandPackages(packages: string[]): string[];
