import { vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as Record<string, any>).IS_REACT_ACT_ENVIRONMENT = true;

// Guarded so test files that opt into the node environment (e.g. the
// keystore crypto suite) can share this setup file without a jsdom window.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn().mockImplementation((query) => ({
      matches: true,
      query,
    })),
  });

  Object.defineProperty(window, "scrollTo", {
    value: vi.fn().mockImplementation((x, y) => ({ x, y })),
  });
}

// jsdom has no ResizeObserver; Radix Slider observes its thumb size.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: ResizeObserverStub,
  });
}
