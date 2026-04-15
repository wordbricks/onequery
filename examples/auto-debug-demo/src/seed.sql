INSERT INTO todos (title) VALUES
  ('Buy groceries'),
  ('Review pull requests'),
  ('Deploy v2.1');

-- Simulated error logs from failed PATCH /todos/:id requests.
-- The bug: src/routes/todos.ts references a non-existent column "completed_at"
-- instead of the actual column "completed".
INSERT INTO error_logs (endpoint, method, error_type, message, stack_trace) VALUES
  ('/todos/1', 'PATCH', 'PostgresError',
   'column "completed_at" of relation "todos" does not exist',
   'error: column "completed_at" of relation "todos" does not exist
    at /app/src/routes/todos.ts:25:28
    at processTicksAndRejections (node:internal/process/task_queues:95:5)'),
  ('/todos/2', 'PATCH', 'PostgresError',
   'column "completed_at" of relation "todos" does not exist',
   'error: column "completed_at" of relation "todos" does not exist
    at /app/src/routes/todos.ts:25:28
    at processTicksAndRejections (node:internal/process/task_queues:95:5)'),
  ('/todos/3', 'PATCH', 'PostgresError',
   'column "completed_at" of relation "todos" does not exist',
   'error: column "completed_at" of relation "todos" does not exist
    at /app/src/routes/todos.ts:25:28
    at processTicksAndRejections (node:internal/process/task_queues:95:5)');
