import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { AdapterStore, type HookEnvelope } from "./store.js";

export function createAdapterHttpServer(
  store: AdapterStore,
  createId: () => string = randomUUID
): Server {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", pending: store.pending().length }));
      return;
    }
    if (request.method !== "POST" || request.url !== "/hooks") {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        const eventName = String(payload.hook_event_name ?? payload.event ?? "");
        const sessionId = String(payload.session_id ?? "");
        if (!eventName || !sessionId) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "event_and_session_required" }));
          return;
        }
        const envelope: HookEnvelope = {
          id: String(payload.event_id ?? createId()),
          eventName,
          sessionId,
          occurredAt: new Date().toISOString(),
          payload
        };
        store.enqueue(envelope);
        response.writeHead(202, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: envelope.id }));
      } catch {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "invalid_json" }));
      }
    });
  });
}
