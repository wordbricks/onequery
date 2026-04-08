import { createStartServer } from "./index";
import { serveWithNode } from "./node-serve";
import { resolveStartupInputFromArgv } from "./startup";

const startPackagedServer = createStartServer({
  serve: serveWithNode,
});

await startPackagedServer(resolveStartupInputFromArgv(process.argv));
