import { mockedStore } from "@/__mocks__/mockedStore";
import { MANUAL_PROBE_COOLDOWN_MS } from "@/stores/qrlStore";
import { StoreProvider } from "@/stores/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import RetryConnection from "./RetryConnection";

const renderComponent = (store = mockedStore()) =>
  render(
    <StoreProvider value={store}>
      <RetryConnection />
    </StoreProvider>,
  );

describe("RetryConnection", () => {
  afterEach(cleanup);

  it("runs the shared probe entry point on click", async () => {
    const probeConnectionNow = vi.fn().mockResolvedValue(true);
    renderComponent(mockedStore({ qrlStore: { probeConnectionNow } }));

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    // The manual flag is what the store charges the cooldown against.
    expect(probeConnectionNow).toHaveBeenCalledWith({ manual: true });
  });

  it("announces that the node is answering again", async () => {
    const probeConnectionNow = vi.fn().mockResolvedValue(true);
    renderComponent(mockedStore({ qrlStore: { probeConnectionNow } }));

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "The node is answering again",
      );
    });
  });

  it("says so when the node is still silent", async () => {
    const probeConnectionNow = vi.fn().mockResolvedValue(false);
    renderComponent(mockedStore({ qrlStore: { probeConnectionNow } }));

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Still not answering",
      );
    });
  });

  it("shows a busy state while the store is probing", () => {
    renderComponent(
      mockedStore({ qrlStore: { qrlConnection: { isProbing: true } } }),
    );

    const button = screen.getByRole("button", { name: /retry/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking the connection",
    );
  });

  it("stays mounted and disabled through the manual cooldown", async () => {
    const probeConnectionNow = vi.fn().mockResolvedValue(false);
    renderComponent(mockedStore({ qrlStore: { probeConnectionNow } }));

    const button = screen.getByRole("button", { name: /retry/i });
    await userEvent.click(button);

    // Disabled rather than hidden, so the control does not flicker out
    // from under the pointer.
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();

    // A second click inside the window never reaches the store. The store
    // enforces the same window itself; this is the visible half of it.
    await userEvent.click(button);
    expect(probeConnectionNow).toHaveBeenCalledTimes(1);
    expect(MANUAL_PROBE_COOLDOWN_MS).toBeGreaterThan(0);
  });
});
