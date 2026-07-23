import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["src/component/**/*.test.ts"],
    typecheck: {
      tsconfig: "./tsconfig.component-test.json",
    },
  },
});
