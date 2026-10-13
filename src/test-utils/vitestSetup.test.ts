import { describe, expect, it, vi } from "vitest";

describe("shared Vitest setup", () => {
  it("enables React act support", () => {
    expect(globalThis).toHaveProperty("IS_REACT_ACT_ENVIRONMENT", true);
  });

  it("returns the media query unchanged with a matching result", () => {
    const query = "(prefers-color-scheme: dark)";

    expect(window.matchMedia(query)).toEqual({ matches: true, query });
  });

  it("preserves both scrollTo overloads and omitted arguments", () => {
    const scrollTo = vi.spyOn(window, "scrollTo");

    window.scrollTo(12, 24);
    expect(scrollTo).toHaveLastReturnedWith({ x: 12, y: 24 });

    const options: ScrollToOptions = { top: 24, left: 12, behavior: "smooth" };
    window.scrollTo(options);
    expect(scrollTo).toHaveLastReturnedWith({ x: options, y: undefined });

    window.scrollTo();
    expect(scrollTo).toHaveLastReturnedWith({ x: undefined, y: undefined });
  });
});
