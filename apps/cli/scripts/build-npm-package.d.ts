export function stagePackagedRuntime(options: {
  runtimeRoot: string;
}): Promise<void>;

export function tarballNameForPackage(
  packageName: string,
  version: string
): string;

export const __internal: {
  indexWorkspacePackageManifestPaths(
    workspacePackageManifests: Array<{
      name: string;
      packageJsonPath: string;
    }>
  ): Map<string, string>;
  restorePackagedExecutableModes(options: {
    targetRoot: string;
    targetTriple: string;
  }): Promise<void>;
  resolveRuntimeAssetSourcePaths(family: string): Promise<
    Array<{
      filename: string;
      sourcePath: string;
    }>
  >;
  resolveWorkspacePackageManifestPath(
    packageSpecifier: string
  ): Promise<string>;
  resolveWorkspacePackageRequire(
    packageSpecifier: string
  ): Promise<NodeJS.Require>;
  stageRuntimeAssets(options: { runtimeRoot: string }): Promise<void>;
};
