import type { AdapterStore } from "./store.js";

export interface ClaimedTask {
  id: string;
  title: string;
  description: string;
  status: string;
  version: number;
  progressPercent?: number | null;
  currentStep?: string | null;
}

function headers(ownerToken: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${ownerToken}` };
}

export async function registerAgent(
  apiUrl: string,
  ownerToken: string,
  agentId: string,
  name: string
): Promise<boolean> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/agents/${encodeURIComponent(agentId)}`, {
    method: "PUT",
    headers: headers(ownerToken),
    body: JSON.stringify({
      name,
      kind: "windows",
      capabilities: ["coding", "codex", "filesystem", "powershell"],
      availability: "online"
    })
  });
  return response.ok;
}

export async function sendHeartbeat(
  apiUrl: string,
  ownerToken: string,
  agentId: string,
  currentTaskId?: string
): Promise<boolean> {
  const response = await fetch(
    `${apiUrl.replace(/\/$/, "")}/v1/agents/${encodeURIComponent(agentId)}/heartbeat`,
    {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify({
        availability: currentTaskId ? "busy" : "online",
        ...(currentTaskId ? { currentTaskId } : {})
      })
    }
  );
  return response.ok;
}

export async function flushOutbox(
  store: AdapterStore,
  apiUrl: string,
  ownerToken: string,
  signal?: AbortSignal
): Promise<number> {
  let completed = 0;
  for (const item of store.pending()) {
    try {
      const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/hooks/codex`, {
        method: "POST",
        headers: headers(ownerToken),
        body: JSON.stringify(item.envelope),
        signal
      });
      if (!response.ok) {
        store.fail(item.sequence, `HTTP ${response.status}`);
        if (response.status >= 500) break;
        continue;
      }
      const result = await response.clone().json().catch(() => undefined) as { status?: string } | undefined;
      if (
        item.envelope.taskId && result?.status &&
        ["DONE", "FAILED", "CANCELLED"].includes(result.status)
      ) {
        store.clearManagedSession(item.envelope.sessionId);
      }
      store.complete(item.sequence);
      completed += 1;
    } catch (error) {
      store.fail(item.sequence, error instanceof Error ? error.name : "network_error");
      break;
    }
  }
  return completed;
}

export async function claimTask(
  apiUrl: string,
  ownerToken: string,
  agentId: string
): Promise<ClaimedTask | undefined> {
  const response = await fetch(
    `${apiUrl.replace(/\/$/, "")}/v1/agents/${encodeURIComponent(agentId)}/claim`,
    {
      method: "POST",
      headers: headers(ownerToken),
      body: JSON.stringify({ capabilities: ["coding", "codex", "filesystem", "powershell"] })
    }
  );
  if (response.status === 204) return undefined;
  if (!response.ok) throw new Error(`claim_failed:${response.status}`);
  return (await response.json() as { task: ClaimedTask }).task;
}

async function postJson(
  url: string,
  ownerToken: string,
  body: Record<string, unknown>
): Promise<Response> {
  return await fetch(url, {
    method: "POST",
    headers: headers(ownerToken),
    body: JSON.stringify(body)
  });
}

export async function updateTaskStage(
  apiUrl: string,
  ownerToken: string,
  task: ClaimedTask,
  currentStep: string,
  progressPercent: number | null
): Promise<ClaimedTask> {
  const response = await postJson(
    `${apiUrl.replace(/\/$/, "")}/v1/tasks/${encodeURIComponent(task.id)}/progress`,
    ownerToken,
    { currentStep, progressPercent, expectedVersion: task.version }
  );
  if (!response.ok) throw new Error(`progress_update_failed:${response.status}`);
  return await response.json() as ClaimedTask;
}

export async function completeTask(
  apiUrl: string,
  ownerToken: string,
  task: ClaimedTask,
  summary: string,
  reference: string
): Promise<void> {
  const base = apiUrl.replace(/\/$/, "");
  const encoded = encodeURIComponent(task.id);
  const evidence = await postJson(`${base}/v1/tasks/${encoded}/evidence`, ownerToken, {
    kind: "artifact",
    summary: summary.slice(0, 2_000),
    reference: reference.slice(0, 2_000)
  });
  if (!evidence.ok) throw new Error(`evidence_failed:${evidence.status}`);
  const verifying = await postJson(`${base}/v1/tasks/${encoded}/transition`, ownerToken, {
    to: "VERIFYING",
    reason: "codex_execution_completed",
    expectedVersion: task.version
  });
  if (!verifying.ok) throw new Error(`verify_transition_failed:${verifying.status}`);
  const changed = await verifying.json() as ClaimedTask;
  try {
    await updateTaskStage(base, ownerToken, { ...task, ...changed }, "Complete", 100);
  } catch {
    // Completion is authoritative; a final cosmetic progress update must not strand VERIFYING work.
  }
  const completed = await postJson(`${base}/v1/tasks/${encoded}/complete`, ownerToken, {});
  if (!completed.ok) throw new Error(`completion_failed:${completed.status}:${changed.version}`);
}

export async function failTask(
  apiUrl: string,
  ownerToken: string,
  task: ClaimedTask,
  reason: string
): Promise<void> {
  const response = await postJson(
    `${apiUrl.replace(/\/$/, "")}/v1/tasks/${encodeURIComponent(task.id)}/transition`,
    ownerToken,
    { to: "FAILED", reason: reason.slice(0, 500), expectedVersion: task.version }
  );
  if (!response.ok && response.status !== 409) throw new Error(`failure_report_failed:${response.status}`);
}
