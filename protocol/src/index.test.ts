import { describe, expect, it } from "vitest";
import {
  TaskStatus,
  canTransition,
  createTaskTitle,
  nextWaitingStatus,
  reduceTaskEvent,
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
});
