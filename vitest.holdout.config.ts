import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Holdout configuration. The evaluator copies a test from holdouts/ into test/
// and removes it after the run. The committed source is never in test/.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.heldout.{ts,tsx}"],
    testTimeout: 15_000,
  },
});
