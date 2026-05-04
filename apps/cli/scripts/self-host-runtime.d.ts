export const cliRootDir: string;

export function resolveStagedCliPath(stagingRoot: string): string;
export function createBundledRuntimeEnv(
  stagingRoot: string,
  env?: NodeJS.ProcessEnv
): NodeJS.ProcessEnv;
export function createStagedBundleRoot(): Promise<string>;
export function cleanupPath(path: string): void;
