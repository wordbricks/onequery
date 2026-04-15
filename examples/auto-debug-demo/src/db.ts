import postgres from "postgres";

const sql = postgres({
  host: "localhost",
  port: 5480,
  database: "demo_app",
  username: "demo",
  password: "demo_secret",
});

export { sql };
