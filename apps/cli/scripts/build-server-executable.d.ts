export function buildServerExecutables(options: {
  outdir: string;
  targetTriple: string;
}): Promise<string[]>;
