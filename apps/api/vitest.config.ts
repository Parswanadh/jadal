import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // `cloudflare:workers` is a workerd-provided virtual module with no resolvable file. Point it at
    // a local stub so workflow modules can be imported (and their classes exercised) under Vitest.
    alias: {
      "cloudflare:workers": fileURLToPath(new URL("./test/cloudflare-workers-stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: "forks",
  },
});
