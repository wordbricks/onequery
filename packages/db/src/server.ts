export {
  createDb,
  createDatabaseHandle,
  getDatabaseEngine,
  type Database,
  type DatabaseEngine,
  type DatabaseHandle,
  schema,
} from "./client";
export {
  prepareApplicationDatabase,
  type DatabasePreparationResult,
} from "./migrations";
export * from "./shared";
