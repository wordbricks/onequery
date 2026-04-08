import { startServer } from "./index";
import { resolveStartupInputFromArgv } from "./startup";

if (import.meta.main) {
  await startServer(resolveStartupInputFromArgv(process.argv));
}
