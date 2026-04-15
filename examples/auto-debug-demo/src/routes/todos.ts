import { Hono } from "hono";

import { sql } from "../db.js";

const app = new Hono();

// GET /todos — list all todos
app.get("/todos", async (c) => {
  const rows = await sql`SELECT * FROM todos ORDER BY created_at DESC`;
  return c.json(rows);
});

// POST /todos — create a todo
app.post("/todos", async (c) => {
  const { title } = await c.req.json<{ title: string }>();
  const rows = await sql`
    INSERT INTO todos (title) VALUES (${title}) RETURNING *
  `;
  return c.json(rows[0], 201);
});

// PATCH /todos/:id — mark a todo as completed
app.patch("/todos/:id", async (c) => {
  const id = c.req.param("id");
  try {
    // BUG: The column is called "completed" (boolean), not "completed_at".
    // A developer renamed the column but forgot to update this query.
    const rows = await sql`
      UPDATE todos SET completed_at = now() WHERE id = ${id} RETURNING *
    `;
    return c.json(rows[0]);
  } catch (err: unknown) {
    const error = err as Error;
    await sql`
      INSERT INTO error_logs (endpoint, method, error_type, message, stack_trace)
      VALUES (${`/todos/${id}`}, 'PATCH', ${error.constructor.name}, ${error.message}, ${error.stack ?? ""})
    `;
    return c.json({ error: "Failed to update todo" }, 500);
  }
});

// DELETE /todos/:id — delete a todo
app.delete("/todos/:id", async (c) => {
  const id = c.req.param("id");
  await sql`DELETE FROM todos WHERE id = ${id}`;
  return c.json({ deleted: true });
});

// GET /health — health check
app.get("/health", (c) => c.json({ status: "ok" }));

export { app as todosApp };
