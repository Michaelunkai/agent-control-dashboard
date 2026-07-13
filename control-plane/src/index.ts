import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import type { Hono } from "hono";
import { handle } from "hono/vercel";
import { createApp } from "./control-app.js";
import { PostgresTaskStore } from "./postgres-store.js";

const databaseUrl = process.env.DATABASE_URL;
const ownerToken = process.env.OWNER_TOKEN;

if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!ownerToken) throw new Error("OWNER_TOKEN is required");

const pool = new Pool({
  connectionString: databaseUrl,
  max: 5,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000
});

attachDatabasePool(pool);

const app: Hono = createApp(new PostgresTaskStore(pool), ownerToken);

export const fetch = handle(app);
