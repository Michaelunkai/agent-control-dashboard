import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required");

const migrations = await Promise.all([
  readFile(new URL("../migrations/0002_postgres.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0003_task_executor.sql", import.meta.url), "utf8"),
  readFile(new URL("../migrations/0004_task_activity_postgres.sql", import.meta.url), "utf8")
]);
const client = new pg.Client({ connectionString });

try {
  await client.connect();
  await client.query("BEGIN");
  for (const sql of migrations) await client.query(sql);
  await client.query("COMMIT");
  process.stdout.write("PostgreSQL migration complete.\n");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
