import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { clearCache } from "../src/lib/cache";

beforeEach(async () => {
  localStorage.clear();
  await clearCache();
  localStorage.setItem("review-radar.token", "test-token");
});

it("surfaces an invalid token and preserves local state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ message: "Bad credentials" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    ),
  );

  render(<App />);

  const error = await screen.findByTestId("auth-error");
  expect(error).toHaveTextContent("Token problem");
  expect(error).toHaveTextContent("rejected");
  expect(screen.getByTestId("review-queue")).toBeInTheDocument();
  expect(localStorage.getItem("review-radar.token")).toBe("test-token");
});
