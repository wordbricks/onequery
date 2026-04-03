export function stagePackagedRuntime(options: {
  runtimeRoot: string;
}): Promise<void>;

export const __internal: {
  indexWorkspacePackageManifestPaths(
    workspacePackageManifests: Array<{
      name: string;
      packageJsonPath: string;
    }>
  ): Map<string, string>;
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
};
