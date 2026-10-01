import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCopy } from "./useCopy";

const Probe = ({ text = "payload" }: { text?: string }) => {
  const { copied, failed, copy } = useCopy({ resetAfterMs: 50 });
  return (
    <div>
      <button type="button" onClick={() => void copy(text)}>
        copy
      </button>
      <span data-testid="state">
        {failed ? "failed" : copied ? "copied" : "idle"}
      </span>
    </div>
  );
};

const setClipboard = (writeText: unknown) => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    writable: true,
    configurable: true,
  });
};

describe("useCopy", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("reports copied only after the clipboard write resolves", async () => {
    let resolveWrite: () => void = () => {};
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    setClipboard(writeText);

    render(<Probe />);
    await userEvent.click(screen.getByRole("button", { name: "copy" }));

    expect(writeText).toHaveBeenCalledWith("payload");
    // The write is still in flight, so nothing may claim success yet.
    expect(screen.getByTestId("state")).toHaveTextContent("idle");

    await act(async () => {
      resolveWrite();
    });
    expect(screen.getByTestId("state")).toHaveTextContent("copied");
  });

  it("surfaces a failure when the clipboard write rejects", async () => {
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));

    render(<Probe />);
    await userEvent.click(screen.getByRole("button", { name: "copy" }));

    expect(screen.getByTestId("state")).toHaveTextContent("failed");
  });

  it("surfaces a failure when the surface has no Clipboard API", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(<Probe />);
    await userEvent.click(screen.getByRole("button", { name: "copy" }));

    expect(screen.getByTestId("state")).toHaveTextContent("failed");
  });

  it("clears its reset timer on unmount", async () => {
    setClipboard(vi.fn().mockResolvedValue(undefined));
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const { unmount } = render(<Probe />);
    await userEvent.click(screen.getByRole("button", { name: "copy" }));
    expect(screen.getByTestId("state")).toHaveTextContent("copied");

    clearTimeoutSpy.mockClear();
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
