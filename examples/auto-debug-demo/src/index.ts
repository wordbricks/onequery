import { Hono } from "hono";

import { todosApp } from "./routes/todos.js";

const app = new Hono();

app.route("/", todosApp);

export default {
  port: 3456,
  fetch: (request: Request) => app.fetch(request),
};
