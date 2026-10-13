import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createRoot, render } = vi.hoisted(() => {
  const render = vi.fn();
  return { createRoot: vi.fn(() => ({ render })), render };
});

vi.mock("react-dom/client", () => ({ default: { createRoot } }));
vi.mock("./App.tsx", () => ({ default: () => null }));
vi.mock("./i18n", () => ({}));

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = '<div id="root"></div>';
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
});

afterEach(() => {
  document.body.replaceChildren();
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
  window.history.replaceState({}, "", "/");
});

describe("entry point", () => {
  it("mounts into the existing root and retains popup dimensions", async () => {
    await import("./main");
    expect(createRoot).toHaveBeenCalledWith(document.getElementById("root"));
    expect(render).toHaveBeenCalledTimes(1);
    expect(document.body).toHaveStyle({ height: "600px", minWidth: "23rem" });
    expect(document.documentElement).toHaveStyle({ height: "600px" });
  });

  it.each(["sidepanel", "tab"])(
    "keeps viewport sizing for %s",
    async (surface) => {
      window.history.replaceState({}, "", `/?${surface}=true`);
      await import("./main");
      expect(createRoot).toHaveBeenCalledTimes(1);
      expect(document.body).toHaveStyle({ height: "", minWidth: "" });
    },
  );

  it("rejects a missing root with the existing container error", async () => {
    document.body.replaceChildren();
    await expect(import("./main")).rejects.toThrow(
      "createRoot(...): Target container is not a DOM element.",
    );
    expect(createRoot).not.toHaveBeenCalled();
  });
});
