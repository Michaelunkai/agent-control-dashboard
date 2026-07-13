import { describe, expect, it } from "vitest";
import {
  TaskStatus,
  canTransition,
  createTaskTitle,
  createWorkspaceTitle,
  nextWaitingStatus,
  resolveTaskTitle,
  reduceTaskEvent,
  validateProgressPercent,
  type Task,
  type TaskEvent
} from "./index.js";

const baseTask: Task = {
  id: "task-1",
  title: "Fix login",
  description: "Fix login redirect in the Android app",
  status: TaskStatus.READY,
  priority: 3,
  version: 1,
  createdAt: "2026-07-12T00:00:00.000Z",
  updatedAt: "2026-07-12T00:00:00.000Z",
  pinnedTitle: false,
  requiredCapabilities: ["coding"],
  dependencies: []
};

describe("task state machine", () => {
  it("allows the normal verified completion lifecycle", () => {
    expect(canTransition(TaskStatus.READY, TaskStatus.QUEUED)).toBe(true);
    expect(canTransition(TaskStatus.QUEUED, TaskStatus.IN_PROGRESS)).toBe(true);
    expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.VERIFYING)).toBe(true);
    expect(canTransition(TaskStatus.VERIFYING, TaskStatus.DONE)).toBe(true);
  });

  it("rejects direct unverified completion", () => {
    expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.DONE)).toBe(false);
  });

  it("selects a precise waiting state", () => {
    expect(nextWaitingStatus({ network: false, pc: true, android: true, quota: true }))
      .toBe(TaskStatus.WAITING_NETWORK);
    expect(nextWaitingStatus({ network: true, pc: false, android: true, quota: true }, "windows"))
      .toBe(TaskStatus.WAITING_PC);
    expect(nextWaitingStatus({ network: true, pc: true, android: true, quota: false }, "cloud"))
      .toBe(TaskStatus.WAITING_QUOTA);
  });

  it("reduces an idempotent status event", () => {
    const event: TaskEvent = {
      id: "event-1",
      taskId: baseTask.id,
      type: "status_changed",
      sequence: 2,
      occurredAt: "2026-07-12T00:01:00.000Z",
      idempotencyKey: "status-queued",
      payload: { from: TaskStatus.READY, to: TaskStatus.QUEUED }
    };
    const changed = reduceTaskEvent(baseTask, event);
    expect(changed.status).toBe(TaskStatus.QUEUED);
    expect(changed.version).toBe(2);
  });

  it("reduces progress and detail events into the task projection", () => {
    const progressed = reduceTaskEvent(baseTask, {
      id: "event-progress", taskId: baseTask.id, type: "progress", sequence: 2,
      occurredAt: "2026-07-12T00:01:00.000Z", idempotencyKey: "progress-1",
      payload: { progressPercent: 45, currentStep: "Running tests" }
    });
    expect(progressed).toMatchObject({ version: 2, progressPercent: 45, currentStep: "Running tests" });

    const detailed = reduceTaskEvent(progressed, {
      id: "event-details", taskId: baseTask.id, type: "details_updated", sequence: 3,
      occurredAt: "2026-07-12T00:02:00.000Z", idempotencyKey: "details-1",
      payload: {
        title: "Verify updated mission", description: "Updated mission",
        pinnedTitle: true, requiredCapabilities: ["android"]
      }
    });
    expect(detailed).toMatchObject({
      version: 3, title: "Verify updated mission", description: "Updated mission",
      pinnedTitle: true, requiredCapabilities: ["android"]
    });
  });
});

describe("task titles", () => {
  it("creates a concise action and target title", () => {
    expect(createTaskTitle("Please fix the login redirect in the Android application immediately"))
      .toBe("Fix login redirect in Android application");
  });

  it("does not exceed 80 characters", () => {
    expect(createTaskTitle("Implement " + "very detailed functionality ".repeat(10)).length)
      .toBeLessThanOrEqual(80);
  });

  it("removes repeated voice-transcription filler", () => {
    expect(createTaskTitle("Please please can you can you fix the sync issue fix the sync issue"))
      .toBe("Fix the sync issue");
  });

  it("uses a readable workspace name for path-only sessions", () => {
    expect(createWorkspaceTitle("C:\\Users\\micha\\Documents\\agent-control-dashboard"))
      .toBe("Codex session - Agent Control Dashboard");
    expect(createWorkspaceTitle(undefined)).toBe("Codex session - Unknown workspace");
  });

  it("pins an explicitly supplied title", () => {
    expect(resolveTaskTitle("Fix the sync issue", "  My release blocker  ")).toEqual({
      title: "My release blocker",
      pinnedTitle: true
    });
    expect(resolveTaskTitle("Fix the sync issue")).toEqual({
      title: "Fix the sync issue",
      pinnedTitle: false
    });
  });
});

describe("task progress", () => {
  it("accepts null and inclusive integer percentages", () => {
    expect(validateProgressPercent(null)).toBeNull();
    expect(validateProgressPercent(0)).toBe(0);
    expect(validateProgressPercent(100)).toBe(100);
  });

  it.each([-1, 101, 1.5, Number.NaN])("rejects invalid progress %s", (value) => {
    expect(() => validateProgressPercent(value)).toThrow("invalid_progress_percent");
  });
});
