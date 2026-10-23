import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Holdout configuration. The evaluator writes scenario tests into test/ and
// removes them after the run. Never checked in by an agent.
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
