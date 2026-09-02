import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import StorageUtil from "@/utilities/storageUtil";
import DAppRequestStore from "./dAppRequestStore";

describe("DAppRequestStore permission refresh", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("refreshes the active dApp after local permission storage changes", () => {
    const fetchCurrentTabData = vi
      .spyOn(DAppRequestStore.prototype, "fetchCurrentTabData")
      .mockResolvedValue();
    new DAppRequestStore();
    const listener = vi.mocked(browser.storage.onChanged.addListener).mock
      .calls[0]?.[0];

    listener?.({ DAPPS: { oldValue: {}, newValue: {} } }, "local");

    expect(fetchCurrentTabData).toHaveBeenCalledTimes(2);
  });

  it("requires each new approval view to install its own callback", async () => {
    vi.spyOn(
      DAppRequestStore.prototype,
      "fetchCurrentTabData",
    ).mockResolvedValue();
    const staleCallback = vi.fn().mockResolvedValue(undefined);
    const store = new DAppRequestStore();
    store.setOnPermissionCallBack(staleCallback);
    store.setCanProceed(true);
    store.addToResponseData({ accounts: ["QStale"] });
    const listener = vi.mocked(browser.storage.onChanged.addListener).mock
      .calls[0]?.[0];

    listener?.({ DAPPS: { oldValue: {}, newValue: {} } }, "session");
    await store.onPermissionCallBack(true);

    expect(store.canProceed).toBe(false);
    expect(store.responseData).toEqual({});
    expect(staleCallback).not.toHaveBeenCalled();
  });

  it("keeps the newest approval request when session reads resolve out of order", async () => {
    vi.spyOn(
      DAppRequestStore.prototype,
      "fetchCurrentTabData",
    ).mockResolvedValue();
    let resolveStaleRequest: ((value: unknown) => void) | undefined;
    let resolveNewestRequest: ((value: unknown) => void) | undefined;
    vi.spyOn(StorageUtil, "getDAppsRequestData")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStaleRequest = resolve;
          }) as never,
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNewestRequest = resolve;
          }) as never,
      );
    const store = new DAppRequestStore();
    const staleRead = store.readDAppRequestData();
    await vi.waitFor(() => {
      expect(resolveStaleRequest).toBeTypeOf("function");
    });
    const newestRead = store.readDAppRequestData();
    await vi.waitFor(() => {
      expect(resolveNewestRequest).toBeTypeOf("function");
    });

    resolveNewestRequest?.({
      requestId: "request-b",
      method: "qrl_signMessage",
    });
    await newestRead;
    expect(store.dAppRequestData).toMatchObject({ requestId: "request-b" });

    resolveStaleRequest?.({
      requestId: "request-a",
      method: "qrl_signMessage",
    });
    await staleRead;
    expect(store.dAppRequestData).toMatchObject({ requestId: "request-b" });
  });

  it("updates an open side panel when the active tab changes origins", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      {
        active: true,
        url: "https://connected.example/app",
        title: "Connected",
        favIconUrl: "",
      } as never,
    ]);
    vi.spyOn(StorageUtil, "getDAppsConnectedAccountsData").mockImplementation(
      async (origin) =>
        origin === "https://connected.example"
          ? ({ accounts: ["QConnected"], blockchains: [] } as never)
          : undefined,
    );
    const store = new DAppRequestStore();
    await vi.waitFor(() => {
      expect(store.currentTabData?.connectedAccounts).toEqual(["QConnected"]);
    });
    const onActivated = vi.mocked(browser.tabs.onActivated.addListener).mock
      .calls[0]?.[0];
    vi.mocked(browser.tabs.query).mockResolvedValue([
      {
        active: true,
        url: "https://disconnected.example/app",
        title: "Disconnected",
        favIconUrl: "",
      } as never,
    ]);

    onActivated?.({ tabId: 2, windowId: 1 });

    await vi.waitFor(() => {
      expect(store.currentTabData).toMatchObject({
        urlOrigin: "https://disconnected.example",
        connectedAccounts: [],
      });
    });
  });

  it("clears the side panel safely while an active tab has no web origin", async () => {
    vi.mocked(browser.tabs.query).mockResolvedValue([
      {
        active: true,
        url: "about:blank",
        title: "New tab",
        favIconUrl: "",
      } as never,
    ]);
    const getConnectedAccounts = vi.spyOn(
      StorageUtil,
      "getDAppsConnectedAccountsData",
    );

    const store = new DAppRequestStore();

    await vi.waitFor(() => {
      expect(store.currentTabData).toMatchObject({
        urlOrigin: "",
        connectedAccounts: [],
        connectedBlockchains: [],
      });
    });
    expect(getConnectedAccounts).not.toHaveBeenCalled();
  });

  it("keeps the newest tab when permission reads resolve out of order", async () => {
    let resolveConnectedTab: ((value: unknown) => void) | undefined;
    vi.mocked(browser.tabs.query).mockResolvedValue([
      {
        active: true,
        url: "about:blank",
        title: "New tab",
        favIconUrl: "",
      } as never,
    ]);
    vi.spyOn(StorageUtil, "getDAppsConnectedAccountsData").mockImplementation(
      (origin) => {
        if (origin === "https://connected.example") {
          return new Promise((resolve) => {
            resolveConnectedTab = resolve;
          }) as never;
        }
        return Promise.resolve({
          accounts: [],
          blockchains: [],
        }) as never;
      },
    );
    const store = new DAppRequestStore();
    await vi.waitFor(() => {
      expect(store.currentTabData?.urlOrigin).toBe("");
    });
    vi.mocked(browser.tabs.query).mockResolvedValue([
      {
        active: true,
        url: "https://connected.example/app",
        title: "Connected",
        favIconUrl: "",
      } as never,
    ]);
    const staleFetch = store.fetchCurrentTabData();
    await vi.waitFor(() => {
      expect(resolveConnectedTab).toBeTypeOf("function");
    });
    vi.mocked(browser.tabs.query).mockResolvedValue([
      {
        active: true,
        url: "https://disconnected.example/app",
        title: "Disconnected",
        favIconUrl: "",
      } as never,
    ]);

    await store.fetchCurrentTabData();
    resolveConnectedTab?.({
      accounts: ["QStale"],
      blockchains: [],
    });
    await staleFetch;
    expect(store.currentTabData).toMatchObject({
      urlOrigin: "https://disconnected.example",
      connectedAccounts: [],
    });
  });
});
