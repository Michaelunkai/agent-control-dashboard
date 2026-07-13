import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

export interface HookEnvelope {
  id: string;
  eventName: string;
  sessionId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface OutboxItem {
  sequence: number;
  envelope: HookEnvelope;
  attempts: number;
  lastError?: string;
}

export class AdapterStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS outbox (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        event_name TEXT NOT NULL,
        session_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS adapter_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  enqueue(envelope: HookEnvelope): void {
    this.database.prepare(`
      INSERT OR IGNORE INTO outbox (id,event_name,session_id,occurred_at,payload)
      VALUES (?,?,?,?,?)
    `).run(
      envelope.id,
      envelope.eventName,
      envelope.sessionId,
      envelope.occurredAt,
      JSON.stringify(envelope.payload)
    );
    if (envelope.eventName === "SessionStart" || envelope.eventName === "UserPromptSubmit") {
      this.database.prepare(
        "INSERT INTO adapter_state(key,value) VALUES('active_task',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
      ).run(`codex:${envelope.sessionId}`);
    } else if (envelope.eventName === "Stop") {
      this.database.prepare("DELETE FROM adapter_state WHERE key='active_task' AND value=?")
        .run(`codex:${envelope.sessionId}`);
    }
  }

  activeTaskId(): string | undefined {
    const row = this.database.prepare("SELECT value FROM adapter_state WHERE key='active_task'")
      .get() as { value: string } | undefined;
    return row?.value;
  }

  setManagedTask(id?: string): void {
    if (id) {
      this.database.prepare(
        "INSERT INTO adapter_state(key,value) VALUES('managed_task',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
      ).run(id);
    } else {
      this.database.prepare("DELETE FROM adapter_state WHERE key='managed_task'").run();
    }
  }

  managedTaskId(): string | undefined {
    const row = this.database.prepare("SELECT value FROM adapter_state WHERE key='managed_task'")
      .get() as { value: string } | undefined;
    return row?.value;
  }

  pending(limit = 50): OutboxItem[] {
    const rows = this.database.prepare(`
      SELECT sequence,id,event_name,session_id,occurred_at,payload,attempts,last_error
      FROM outbox ORDER BY sequence LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      sequence: Number(row.sequence),
      envelope: {
        id: String(row.id),
        eventName: String(row.event_name),
        sessionId: String(row.session_id),
        occurredAt: String(row.occurred_at),
        payload: JSON.parse(String(row.payload)) as Record<string, unknown>
      },
      attempts: Number(row.attempts),
      lastError: row.last_error ? String(row.last_error) : undefined
    }));
  }

  complete(sequence: number): void {
    this.database.prepare("DELETE FROM outbox WHERE sequence=?").run(sequence);
  }

  fail(sequence: number, error: string): void {
    this.database.prepare(
      "UPDATE outbox SET attempts=attempts+1,last_error=? WHERE sequence=?"
    ).run(error.slice(0, 500), sequence);
  }

  close(): void {
    this.database.close();
  }
}
