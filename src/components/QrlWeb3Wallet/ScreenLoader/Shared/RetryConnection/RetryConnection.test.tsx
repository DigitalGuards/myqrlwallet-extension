import { mockedStore } from "@/__mocks__/mockedStore";
import type QrlStore from "@/stores/qrlStore";
import {
  MANUAL_PROBE_COOLDOWN_MS,
  type ConnectionProbeResult,
} from "@/stores/qrlStore";
import { StoreProvider } from "@/stores/store";
import type { StoreType } from "@/stores/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { observable, runInAction } from "mobx";
import { afterEach, describe, expect, it, vi } from "vitest";
import RetryConnection from "./RetryConnection";

/**
 * A stand-in store that enforces the manual cooldown the way the real one
 * does, on an observable the control reads. The control's job is to render
 * that state honestly, so the cooldown has to live outside it.
 */
const probeStore = (options?: {
  isConnected?: boolean;
  isProbing?: boolean;
}) => {
  const qrlConnection = observable({
    isConnected: options?.isConnected ?? false,
    isLoading: false,
    isProbing: options?.isProbing ?? false,
    areBalancesStale: false,
    nextManualProbeAt: 0,
  });
  const probeConnectionNow = vi.fn(
    async (probeOptions?: {
      manual?: boolean;
    }): Promise<ConnectionProbeResult> => {
      const now = Date.now();
      if (
        probeOptions?.manual === true &&
        now < qrlConnection.nextManualProbeAt
      )
        return { probed: false, isConnected: qrlConnection.isConnected };
      runInAction(() => {
        qrlConnection.nextManualProbeAt = now + MANUAL_PROBE_COOLDOWN_MS;
      });
      return { probed: true, isConnected: qrlConnection.isConnected };
    },
  );

  const base = mockedStore();
  const qrlStore = Object.create(base.qrlStore) as QrlStore;
  Object.defineProperties(qrlStore, {
    qrlConnection: { value: qrlConnection, configurable: true },
    probeConnectionNow: { value: probeConnectionNow, configurable: true },
  });
  return { store: { ...base, qrlStore } as StoreType, probeConnectionNow };
};

const renderComponent = (store: StoreType) =>
  render(
    <StoreProvider value={store}>
      <RetryConnection />
    </StoreProvider>,
  );

describe("RetryConnection", () => {
  afterEach(cleanup);

  it("runs the shared probe entry point on click", async () => {
    const { store, probeConnectionNow } = probeStore();
    renderComponent(store);

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    // The manual flag is what the store charges the cooldown against.
    expect(probeConnectionNow).toHaveBeenCalledWith({ manual: true });
  });

  it("announces that the node is answering again", async () => {
    const { store } = probeStore({ isConnected: true });
    renderComponent(store);

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "The node is answering again",
      );
    });
  });

  it("says so when the node is still silent", async () => {
    const { store } = probeStore({ isConnected: false });
    renderComponent(store);

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Still not answering",
      );
    });
  });

  it("shows a busy state while the store is probing", () => {
    const { store } = probeStore({ isProbing: true });
    renderComponent(store);

    const button = screen.getByRole("button", { name: /retry/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking the connection",
    );
  });

  it("stays mounted and disabled through the manual cooldown", async () => {
    const { store, probeConnectionNow } = probeStore();
    renderComponent(store);

    const button = screen.getByRole("button", { name: /retry/i });
    await userEvent.click(button);

    // Disabled and still mounted, so the control does not flicker out
    // from under the pointer.
    expect(button).toBeInTheDocument();
    await waitFor(() => {
      expect(button).toBeDisabled();
    });

    await userEvent.click(button);
    expect(probeConnectionNow).toHaveBeenCalledTimes(1);
  });

  it("reports no verdict when the store declined to probe", async () => {
    // The store also skips when there is no provider yet, or while the
    // wallet is locked. Neither leaves the button disabled, so the control
    // has to notice that nothing was checked and stay quiet.
    const { store } = probeStore();
    const declining = vi
      .fn()
      .mockResolvedValue({ probed: false, isConnected: false });
    Object.defineProperty(store.qrlStore, "probeConnectionNow", {
      value: declining,
      configurable: true,
    });
    renderComponent(store);

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(declining).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("");
    });
    expect(screen.queryByText("Still not answering")).not.toBeInTheDocument();
  });

  it("keeps the cooldown across a remount and reports no verdict without a probe", async () => {
    const { store, probeConnectionNow } = probeStore();
    const first = renderComponent(store);

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(
        "Still not answering",
      );
    });

    // Navigate away and back inside the cooldown window. A control that
    // kept the deadline in its own state came back looking ready, and its
    // first click then reported a verdict the store had never gone and
    // checked.
    first.unmount();
    renderComponent(store);

    const button = screen.getByRole("button", { name: /retry/i });
    expect(button).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(probeConnectionNow).toHaveBeenCalledTimes(1);
  });
});
