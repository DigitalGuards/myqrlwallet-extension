import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeliberateApproveButton, {
  APPROVE_HOLD_MS,
  APPROVE_PROTECTION_MS,
} from "./DeliberateApproveButton";

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe("DeliberateApproveButton", () => {
  const onApprove = vi.fn();

  const renderButton = (disabled = false) =>
    render(
      <StoreProvider value={mockedStore()}>
        <DeliberateApproveButton onApprove={onApprove} disabled={disabled}>
          Yes
        </DeliberateApproveButton>
      </StoreProvider>,
    );
  const yes = () => screen.getByRole("button", { name: "Yes" });
  const pointerClick = () => {
    fireEvent.click(yes(), { detail: 1 });
  };
  const keyDown = (key = "Enter", repeat = false) => {
    fireEvent.keyDown(yes(), { key, repeat });
  };
  const keyUp = (key = "Enter") => {
    fireEvent.keyUp(yes(), { key });
  };
  // Opens the protection window and waits it out.
  const ready = () => {
    renderButton();
    advance(APPROVE_PROTECTION_MS + 1);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    onApprove.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("ignores a click right after the prompt renders", () => {
    renderButton();
    advance(APPROVE_PROTECTION_MS - 50);
    pointerClick();
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("approves a click once the protection window has passed", () => {
    ready();
    pointerClick();
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("restarts the window when the window gains focus", () => {
    ready();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    advance(APPROVE_PROTECTION_MS - 50);
    pointerClick();
    expect(onApprove).not.toHaveBeenCalled();
    advance(100);
    pointerClick();
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("restarts the window when the document becomes visible", () => {
    ready();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    advance(APPROVE_PROTECTION_MS - 50);
    pointerClick();
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("restarts the window when the button becomes enabled", () => {
    const view = renderButton(true);
    advance(APPROVE_PROTECTION_MS + 1);
    view.rerender(
      <StoreProvider value={mockedStore()}>
        <DeliberateApproveButton onApprove={onApprove} disabled={false}>
          Yes
        </DeliberateApproveButton>
      </StoreProvider>,
    );
    pointerClick();
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("ignores an Enter tap", () => {
    ready();
    keyDown();
    advance(100);
    keyUp();
    advance(APPROVE_HOLD_MS * 2);
    expect(onApprove).not.toHaveBeenCalled();
    expect(
      screen.getByText("Not approved. Hold Enter to approve."),
    ).toBeInTheDocument();
  });

  it("ignores the click a keyboard activation produces", () => {
    ready();
    fireEvent.click(yes(), { detail: 0 });
    expect(onApprove).not.toHaveBeenCalled();
  });

  it.each(["Enter", " "])("approves once when %j is held", (key) => {
    ready();
    keyDown(key);
    advance(APPROVE_HOLD_MS - 10);
    expect(onApprove).not.toHaveBeenCalled();
    advance(20);
    expect(onApprove).toHaveBeenCalledTimes(1);
    keyUp(key);
    advance(APPROVE_HOLD_MS * 2);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("cancels when the key is released before the hold ends", () => {
    ready();
    keyDown();
    advance(500);
    keyUp();
    advance(APPROVE_HOLD_MS);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("neither restarts nor multiplies on key repeat", () => {
    ready();
    keyDown();
    advance(400);
    keyDown("Enter", true);
    advance(200);
    keyDown("Enter", true);
    advance(110);
    expect(onApprove).toHaveBeenCalledTimes(1);
    keyDown("Enter", true);
    advance(APPROVE_HOLD_MS * 2);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("cancels when the button loses focus", () => {
    ready();
    yes().focus();
    keyDown();
    advance(300);
    fireEvent.blur(yes());
    advance(APPROVE_HOLD_MS);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("cancels when the window loses focus", () => {
    ready();
    keyDown();
    advance(300);
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    advance(APPROVE_HOLD_MS);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("ignores a key press inside the protection window", () => {
    renderButton();
    keyDown();
    advance(APPROVE_HOLD_MS + 10);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("does not approve when the window is protected again before the hold ends", () => {
    ready();
    keyDown();
    advance(300);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    advance(APPROVE_HOLD_MS);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("shows the hold hint while the button has keyboard focus", () => {
    ready();
    expect(screen.queryByText("Hold Enter to approve")).not.toBeInTheDocument();
    fireEvent.focus(yes());
    expect(screen.getByText("Hold Enter to approve")).toBeInTheDocument();
    fireEvent.blur(yes());
    expect(screen.queryByText("Hold Enter to approve")).not.toBeInTheDocument();
  });
});
