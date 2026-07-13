import { describe, expect, it } from "vitest";
import worker, { type Env } from "./worker.js";

const env = {
  DB: {} as D1Database,
  OWNER_TOKEN: "owner-secret"
} satisfies Env;

describe("worker authorization boundary", () => {
  it("rejects missing and incorrect owner tokens on versioned APIs", async () => {
    const missing = await worker.fetch(new Request("https://control.example/v1/tasks"), env);
    const incorrect = await worker.fetch(new Request("https://control.example/v1/tasks", {
      headers: { authorization: "Bearer wrong" }
    }), env);

    expect(missing.status).toBe(401);
    expect(incorrect.status).toBe(401);
  });

  it("leaves the unauthenticated health endpoint available", async () => {
    const response = await worker.fetch(new Request("https://control.example/health"), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
