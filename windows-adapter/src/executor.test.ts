import { describe, expect, it } from "vitest";
import { executionTimeoutMs } from "./executor.js";

describe("executionTimeoutMs", () => {
  it("defaults to two hours", () => {
    expect(executionTimeoutMs(undefined)).toBe(7_200_000);
  });

  it("accepts configured limits of at least one minute", () => {
    expect(executionTimeoutMs("60000")).toBe(60_000);
    expect(executionTimeoutMs("1800000")).toBe(1_800_000);
  });

  it("rejects invalid and dangerously short limits", () => {
    expect(executionTimeoutMs("not-a-number")).toBe(7_200_000);
    expect(executionTimeoutMs("1000")).toBe(7_200_000);
  });
});
