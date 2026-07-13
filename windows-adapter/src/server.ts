import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { AdapterStore } from "./store.js";
import { claimTask, completeTask, failTask, flushOutbox, registerAgent, sendHeartbeat } from "./sync.js";
import { importHookFallback } from "./fallback.js";
import { createAdapterHttpServer } from "./http-server.js";
import { evidenceReference, executeTask } from "./executor.js";

const dataRoot = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
const agentControlRoot = join(dataRoot, "AgentControl");
const store = new AdapterStore(join(agentControlRoot, "adapter.db"));
const fallbackPath = join(agentControlRoot, "hook-fallback.jsonl");
const taskRoot = join(agentControlRoot, "tasks");
const agentId = process.env.AgentControl__AgentId ?? `windows-${hostname().toLowerCase()}`;
let registered = false;
let syncInProgress = false;

const server = createAdapterHttpServer(store);
server.listen(17867, "127.0.0.1");

const timer = setInterval(() => {
  if (syncInProgress) return;
  syncInProgress = true;
  importHookFallback(store, fallbackPath);
  const apiUrl = process.env.AgentControl__ApiUrl;
  const ownerToken = process.env.AgentControl__OwnerToken;
  void (async () => {
    try {
      if (apiUrl && ownerToken) {
        if (!registered) registered = await registerAgent(apiUrl, ownerToken, agentId, `Codex on ${hostname()}`);
        if (registered) {
          await sendHeartbeat(apiUrl, ownerToken, agentId, store.managedTaskId() ?? store.activeTaskId());
          await flushOutbox(store, apiUrl, ownerToken);
          const task = await claimTask(apiUrl, ownerToken, agentId);
          if (task) {
            store.setManagedTask(task.id);
            const heartbeatTimer = setInterval(() => {
              void sendHeartbeat(apiUrl, ownerToken, agentId, task.id).catch((error) => {
                console.error("Agent Control execution heartbeat failed:", error);
              });
            }, 30_000);
            try {
              await sendHeartbeat(apiUrl, ownerToken, agentId, task.id);
              const result = await executeTask(task, taskRoot);
              if (result.exitCode === 0) {
                await completeTask(apiUrl, ownerToken, task, result.summary, evidenceReference(result.outputPath));
              } else {
                await failTask(apiUrl, ownerToken, task, `Codex exited with code ${result.exitCode}`);
              }
            } finally {
              clearInterval(heartbeatTimer);
              store.setManagedTask();
              try {
                await sendHeartbeat(apiUrl, ownerToken, agentId);
              } catch (error) {
                console.error("Agent Control idle heartbeat failed:", error);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Agent Control synchronization failed:", error);
    } finally {
      syncInProgress = false;
    }
  })();
}, 5_000);

function shutdown(): void {
  clearInterval(timer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
