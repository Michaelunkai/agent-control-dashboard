import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { AdapterStore } from "./store.js";
import { createAdapterHttpServer } from "./http-server.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe("adapter HTTP server", () => {
  it("accepts valid hooks and reports pending health", async () => {
    const { baseUrl, store } = await startServer();
    const hook = await fetch(`${baseUrl}/hooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hook_event_name: "SessionStart", session_id: "session-http" })
    });
    expect(hook.status).toBe(202);
    expect(await hook.json()).toEqual({ id: "generated-id" });
    const health = await fetch(`${baseUrl}/health`);
    expect(await health.json()).toEqual({ status: "ok", pending: 1, managedTaskId: null });
    expect(store.activeTaskId()).toBe("codex:session-http");
  });

  it("rejects invalid routes and payloads", async () => {
    const { baseUrl } = await startServer();
    expect((await fetch(`${baseUrl}/missing`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/hooks`, { method: "POST", body: "{" })).status).toBe(400);
    expect((await fetch(`${baseUrl}/hooks`, {
      method: "POST",
      body: JSON.stringify({ session_id: "missing-event" })
    })).status).toBe(400);
  });

  it("derives a verified mission result from the documented Stop message", async () => {
    const { baseUrl, store } = await startServer();
    const response = await fetch(`${baseUrl}/hooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hook_event_name: "Stop",
        session_id: "session-result",
        last_assistant_message: "Tests passed.\n\nAGENT_CONTROL_RESULT: DONE"
      })
    });
    expect(response.status).toBe(202);
    expect(store.pending()[0]?.envelope.payload).toEqual(expect.objectContaining({
      agent_control_result: "DONE",
      result_summary: "Tests passed."
    }));
  });

  it("does not infer completion when a Stop message has no result marker", async () => {
    const { baseUrl, store } = await startServer();
    await fetch(`${baseUrl}/hooks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hook_event_name: "Stop",
        session_id: "session-interrupted",
        last_assistant_message: "Partial work only"
      })
    });
    expect(store.pending()[0]?.envelope.payload).not.toHaveProperty("agent_control_result");
  });

  it("rejects duplicate or non-final result markers as ambiguous", async () => {
    const { baseUrl, store } = await startServer();
    for (const [index, lastAssistantMessage] of [
      "AGENT_CONTROL_RESULT: DONE\nAGENT_CONTROL_RESULT: FAILED",
      "AGENT_CONTROL_RESULT: DONE\nAdditional unverified text"
    ].entries()) {
      await fetch(`${baseUrl}/hooks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hook_event_name: "Stop",
          session_id: `session-ambiguous-${index}`,
          last_assistant_message: lastAssistantMessage
        })
      });
    }
    for (const pending of store.pending()) {
      expect(pending.envelope.payload).not.toHaveProperty("agent_control_result");
    }
  });
});

async function startServer(): Promise<{ baseUrl: string; store: AdapterStore }> {
  const root = mkdtempSync(join(tmpdir(), "agent-control-http-"));
  const store = new AdapterStore(join(root, "adapter.db"));
  const server = createAdapterHttpServer(store, () => "generated-id");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  cleanups.push(() => {
    server.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  return { baseUrl: `http://127.0.0.1:${port}`, store };
}
