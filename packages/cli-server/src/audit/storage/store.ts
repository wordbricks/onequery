import type { Database } from "@onequery/db/server";

import type { SourceApiActionCommand } from "../source-api-action-family";
import { storeSourceApiActionCommandViaJournal } from "./source-api-action-journal";

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
