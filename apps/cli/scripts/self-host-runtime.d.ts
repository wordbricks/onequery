export const cliRootDir: string;
export const workspaceRootDir: string;
export const cliManifestPath: string;
export const cliBinaryName: string;
export const targetTriple: string;

export function resolveCargoBinaryPath(): string;
export function resolveBundledRuntimeRoot(stagingRoot: string): string;
export function resolveStagedCliPath(stagingRoot: string): string;
export function createBundledRuntimeEnv(
  stagingRoot: string,
  env?: NodeJS.ProcessEnv
): NodeJS.ProcessEnv;
export function buildCliBinary(): string;
export function createStagedBundleRoot(): Promise<string>;
export function cleanupPath(path: string): void;
