import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    // Holdout tests live in holdouts/ and are materialised here only by the
    // evaluator for the duration of a run.
    exclude: ["test/**/*.heldout.{ts,tsx}"],
    testTimeout: 10_000,
  },
});
