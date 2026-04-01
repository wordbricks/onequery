import type { Database } from "@onequery/db/server";

type BootstrapState = {
  isBootstrapped: boolean;
  needsBootstrap: boolean;
};

export async function readBootstrapState(
  db: Database
): Promise<BootstrapState> {
  const existingUser = await db.query.user.findFirst({
    columns: { id: true },
  });

  const isBootstrapped = existingUser !== undefined;

  return {
    isBootstrapped,
    needsBootstrap: !isBootstrapped,
  };
}
