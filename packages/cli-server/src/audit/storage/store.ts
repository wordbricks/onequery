import type { Database } from "@onequery/db/server";

import type { QueryActionCommand } from "../query-action-family";
import type { SourceApiActionCommand } from "../source-api-action-family";
import { storeQueryActionCommandViaJournal } from "./query-action-journal";
import { storeSourceApiActionCommandViaJournal } from "./source-api-action-journal";

export async function storeQueryActionCommand(input: {
  command: QueryActionCommand;
  db: Database;
}) {
  return storeQueryActionCommandViaJournal({
    command: input.command,
    db: input.db,
  });
}

export async function storeSourceApiActionCommand(input: {
  command: SourceApiActionCommand;
  completedEffectId?: string;
  db: Database;
}) {
  return storeSourceApiActionCommandViaJournal({
    command: input.command,
    completedEffectId: input.completedEffectId,
    db: input.db,
  });
}
