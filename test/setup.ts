import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  // The dashboard keeps its view state in the URL; a leftover hash from one
  // test would otherwise be restored as another test's starting state.
  if (typeof window !== "undefined") window.location.hash = "";
});
