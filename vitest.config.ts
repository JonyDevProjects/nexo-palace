import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    deps: {
      interopDefault: true,
    },
  },
  // Vite uses esbuild for TS transform by default — handles .ts natively
});
