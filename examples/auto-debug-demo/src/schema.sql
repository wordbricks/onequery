CREATE TABLE IF NOT EXISTS todos (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  completed   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS error_logs (
  id          SERIAL PRIMARY KEY,
  endpoint    TEXT NOT NULL,
  method      TEXT NOT NULL,
  error_type  TEXT NOT NULL,
  message     TEXT NOT NULL,
  stack_trace TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
