import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AdapterStore } from "./store.js";
import {
  claimTask, failTask, flushOutbox, registerAgent, sendHeartbeat, updateTaskStage
} from "./sync.js";
import { importHookFallback } from "./fallback.js";
import { createAdapterHttpServer } from "./http-server.js";
import { executeTask } from "./executor.js";
import { repairHookRegistration } from "./hook-registration.js";

const dataRoot = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
const agentControlRoot = join(dataRoot, "AgentControl");
const store = new AdapterStore(join(agentControlRoot, "adapter.db"));
const fallbackPath = join(agentControlRoot, "hook-fallback.jsonl");
const taskRoot = join(agentControlRoot, "tasks");
const hooksPath = join(homedir(), ".codex", "hooks.json");
const hookScriptPath = fileURLToPath(new URL("../hooks/Invoke-AgentControlHook.ps1", import.meta.url));
const agentId = process.env.AgentControl__AgentId ?? `windows-${hostname().toLowerCase()}`;
let registered = false;
let syncInProgress = false;

function repairHooks(): void {
  try {
    repairHookRegistration(hooksPath, hookScriptPath);
  } catch (error) {
    console.error("Agent Control hook registration repair failed:", error);
  }
}

repairHooks();
const hookRepairTimer = setInterval(repairHooks, 30_000);

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
          let task = store.managedTaskId()
            ? undefined
            : await claimTask(apiUrl, ownerToken, agentId);
          if (task) {
            const taskId = task.id;
            store.setManagedTask(taskId);
            const heartbeatTimer = setInterval(() => {
              void sendHeartbeat(apiUrl, ownerToken, agentId, taskId).catch((error) => {
                console.error("Agent Control execution heartbeat failed:", error);
              });
            }, 30_000);
            try {
              await sendHeartbeat(apiUrl, ownerToken, agentId, task.id);
              task = await updateTaskStage(apiUrl, ownerToken, task, "Assigned", 5);
              task = await updateTaskStage(apiUrl, ownerToken, task, "Preparing", 15);
              task = await updateTaskStage(apiUrl, ownerToken, task, "Opening pinned Codex Desktop session", 20);
              const result = await executeTask(task, taskRoot);
              store.bindManagedSession(task.id, result.sessionId);
              task = await updateTaskStage(apiUrl, ownerToken, task, "Working in pinned Codex Desktop session", null);
            } catch (error) {
              await failTask(
                apiUrl, ownerToken, task,
                error instanceof Error ? error.message : "desktop_launch_failed"
              );
              store.setManagedTask();
            } finally {
              clearInterval(heartbeatTimer);
              try {
                await sendHeartbeat(apiUrl, ownerToken, agentId, store.managedTaskId());
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
  clearInterval(hookRepairTimer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
