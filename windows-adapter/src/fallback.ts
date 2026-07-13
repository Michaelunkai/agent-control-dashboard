import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { AdapterStore, type HookEnvelope } from "./store.js";

export interface FallbackImportResult {
  imported: number;
  invalid: number;
}

export function importHookFallback(store: AdapterStore, path: string): FallbackImportResult {
  if (!existsSync(path)) return { imported: 0, invalid: 0 };

  const claimedPath = `${path}.${process.pid}.${Date.now()}.processing`;
  try {
    renameSync(path, claimedPath);
  } catch {
    return { imported: 0, invalid: 0 };
  }

  const invalidLines: string[] = [];
  let imported = 0;
  for (const line of readFileSync(claimedPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const payload = JSON.parse(line) as Record<string, unknown>;
      const eventName = String(payload.hook_event_name ?? payload.event ?? "");
      const sessionId = String(payload.session_id ?? "");
      if (!eventName || !sessionId) throw new Error("event_and_session_required");
      const envelope: HookEnvelope = {
        id: String(payload.event_id ?? randomUUID()),
        eventName,
        sessionId,
        occurredAt: new Date().toISOString(),
        payload
      };
      store.enqueue(envelope);
      imported += 1;
    } catch {
      invalidLines.push(line);
    }
  }

  if (invalidLines.length > 0) {
    writeFileSync(`${claimedPath}.invalid`, `${invalidLines.join("\n")}\n`, "utf8");
  }
  unlinkSync(claimedPath);
  return { imported, invalid: invalidLines.length };
}
