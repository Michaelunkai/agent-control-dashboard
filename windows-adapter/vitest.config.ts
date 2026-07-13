import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: ["dist/**", "src/server.ts", "src/**/*.test.ts", "vitest.config.ts"]
    }
  }
});
