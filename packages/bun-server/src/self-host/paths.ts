import { homedir, platform } from "node:os";
import { isAbsolute, resolve } from "node:path";

const APP_DIR_NAME = "onequery";
const SELF_HOST_CONFIG_DIR_NAME = "self-host";
const CONFIG_FILENAME = "config.toml";
const SECRETS_CONFIG_FILENAME = "secrets.toml";
const PGLITE_DIRNAME = "onequery";
const SERVER_LOG_FILENAME = "server.log";
const PID_FILENAME = "server.pid";
const LOCK_FILENAME = "server.lock";

export interface SelfHostRuntimePaths {
  configDir: string;
  dataDir: string;
  configPath: string;
  secretsPath: string;
  pgliteDir: string;
  logsDir: string;
  serverLogPath: string;
  backupsDir: string;
  runDir: string;
  pidPath: string;
  lockPath: string;
}

interface PlatformAccess {
  homedir(): string;
  platform(): NodeJS.Platform;
}

const defaultPlatformAccess: PlatformAccess = {
  homedir,
  platform,
};

export function resolveSelfHostRuntimePaths(
  env: NodeJS.ProcessEnv,
  platformAccess: PlatformAccess = defaultPlatformAccess
): SelfHostRuntimePaths {
  const cwd = process.cwd();
  const configDir = resolveConfigDir(env, platformAccess, cwd);
  const dataDir = resolveDataDir(env, platformAccess, cwd);
  const pgliteDir = resolve(dataDir, "pglite", PGLITE_DIRNAME);
  const logsDir = resolve(dataDir, "logs");
  const runDir = resolve(dataDir, "run");

  return {
    configDir,
    dataDir,
    configPath: resolve(configDir, CONFIG_FILENAME),
    secretsPath: resolve(configDir, SECRETS_CONFIG_FILENAME),
    pgliteDir,
    logsDir,
    serverLogPath: resolve(logsDir, SERVER_LOG_FILENAME),
    backupsDir: resolve(dataDir, "backups"),
    runDir,
    pidPath: resolve(runDir, PID_FILENAME),
    lockPath: resolve(runDir, LOCK_FILENAME),
  };
}

function resolveConfigDir(
  env: NodeJS.ProcessEnv,
  platformAccess: PlatformAccess,
  cwd: string
): string {
  if (env.ONEQUERY_SELF_HOST_CONFIG_DIR) {
    return resolvePathRoot(env.ONEQUERY_SELF_HOST_CONFIG_DIR, cwd);
  }

  const configRoot = resolvePlatformConfigRoot(env, platformAccess, cwd);
  return resolve(configRoot, APP_DIR_NAME, SELF_HOST_CONFIG_DIR_NAME);
}

function resolvePlatformConfigRoot(
  env: NodeJS.ProcessEnv,
  platformAccess: PlatformAccess,
  cwd: string
): string {
  if (platformAccess.platform() === "win32") {
    if (env.APPDATA) {
      return resolvePathRoot(env.APPDATA, cwd);
    }
    return resolve(platformAccess.homedir(), "AppData", "Roaming");
  }

  if (env.XDG_CONFIG_HOME) {
    return resolvePathRoot(env.XDG_CONFIG_HOME, cwd);
  }

  return resolve(platformAccess.homedir(), ".config");
}

function resolveDataDir(
  env: NodeJS.ProcessEnv,
  platformAccess: PlatformAccess,
  cwd: string
): string {
  if (env.ONEQUERY_SELF_HOST_DATA_DIR) {
    return resolvePathRoot(env.ONEQUERY_SELF_HOST_DATA_DIR, cwd);
  }

  const dataRoot = resolvePlatformDataRoot(env, platformAccess, cwd);
  return resolve(dataRoot, APP_DIR_NAME);
}

function resolvePlatformDataRoot(
  env: NodeJS.ProcessEnv,
  platformAccess: PlatformAccess,
  cwd: string
): string {
  if (platformAccess.platform() === "win32") {
    if (env.LOCALAPPDATA) {
      return resolvePathRoot(env.LOCALAPPDATA, cwd);
    }
    return resolve(platformAccess.homedir(), "AppData", "Local");
  }

  if (env.XDG_DATA_HOME) {
    return resolvePathRoot(env.XDG_DATA_HOME, cwd);
  }

  return resolve(platformAccess.homedir(), ".local", "share");
}

function resolvePathRoot(candidate: string, cwd: string): string {
  return isAbsolute(candidate) ? candidate : resolve(cwd, candidate);
}

export function runtimeDirPaths(paths: SelfHostRuntimePaths): string[] {
  return [
    paths.configDir,
    paths.pgliteDir,
    paths.logsDir,
    paths.backupsDir,
    paths.runDir,
  ];
}
