import { profileStorageKey } from "@/utilities/profileStorage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import StorageUtil from "@/utilities/storageUtil";
import DAppRequestStore from "./dAppRequestStore";
import { EXTENSION_MESSAGES } from "@/scripts/constants/streamConstants";

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

    listener?.(
      { [profileStorageKey("DAPPS")]: { oldValue: {}, newValue: {} } },
      "local",
    );

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

    listener?.(
      { [profileStorageKey("DAPPS")]: { oldValue: {}, newValue: {} } },
      "session",
    );
    await store.onPermissionCallBack(true, () => undefined);

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

describe("DAppRequestStore answers the request the user clicked on", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(
      DAppRequestStore.prototype,
      "fetchCurrentTabData",
    ).mockResolvedValue();
    // The service worker acknowledges a live request; see confirmRequestIsLive.
    acknowledgeInProgress({ accepted: true });
  });

  /**
   * Answer the in-progress acknowledgement with `ack` and every other
   * runtime message with undefined, the way the worker does.
   */
  const acknowledgeInProgress = (ack: unknown) => {
    vi.mocked(browser.runtime.sendMessage).mockImplementation(
      async (message: unknown) => {
        const action = (message as { action?: string })?.action;
        if (action === EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS) return ack;
        return undefined;
      },
    );
  };

  const sentMessages = () =>
    vi
      .mocked(browser.runtime.sendMessage)
      .mock.calls.map((call) => call[0] as Record<string, unknown>);

  const sentResponse = () =>
    sentMessages().find(
      (message) => message.action === EXTENSION_MESSAGES.DAPP_RESPONSE,
    );

  const buildStore = (requestId: string, method = "qrl_sendTransaction") => {
    const store = new DAppRequestStore();
    store.dAppRequestData = { requestId, method };
    return store;
  };

  const swapInAnotherRequest = (store: DAppRequestStore) => {
    // What the session-storage subscription does when a second dApp takes
    // the approval slot while this approval is still running.
    const listener = vi.mocked(browser.storage.onChanged.addListener).mock
      .calls[0]?.[0];
    listener?.(
      { [profileStorageKey("DAPPS")]: { oldValue: {}, newValue: {} } },
      "session",
    );
    store.dAppRequestData = {
      requestId: "request-b",
      method: "qrl_signMessage",
    };
  };

  it("posts the requestId captured at click time (M1)", async () => {
    const store = buildStore("request-a");
    store.setOnPermissionCallBack(async () => {
      swapInAnotherRequest(store);
    });

    await store.onPermission(true);

    expect(sentResponse()).toMatchObject({
      requestId: "request-a",
      method: "qrl_sendTransaction",
      hasApproved: true,
    });
  });

  it("keeps the approval's own result out of the newer request (M1)", async () => {
    const store = buildStore("request-a");
    store.setOnPermissionCallBack(async (_hasApproved, record) => {
      swapInAnotherRequest(store);
      record({ transactionHash: "0xabc" });
    });

    await store.onPermission(true);

    expect(sentResponse()?.response).toEqual({ transactionHash: "0xabc" });
    // The newer request's own view starts empty.
    expect(store.responseData).toEqual({});
  });

  it("keeps two approvals in flight apart (L-8, L-3)", async () => {
    const store = buildStore("request-a");
    let releaseFirst: (() => void) | undefined;
    let recordFirst: ((data: Record<string, unknown>) => void) | undefined;
    store.setOnPermissionCallBack(async (_hasApproved, record) => {
      recordFirst = record;
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      // Written after the second approval has come and gone, through the
      // recorder bound to this run.
      record({ transactionHash: "0xfirst" });
    });
    const first = store.onPermission(true);
    await vi.waitFor(() => {
      expect(releaseFirst).toBeTypeOf("function");
    });
    expect(recordFirst).toBeTypeOf("function");

    // A second approval runs to completion while the first is still
    // waiting on its broadcast.
    store.dAppRequestData = {
      requestId: "request-b",
      method: "qrl_signMessage",
    };
    store.setOnPermissionCallBack(async (_hasApproved, record) => {
      record({ signature: "0xsecond" });
    });
    await store.onPermission(true);
    releaseFirst?.();
    await first;

    const responses = sentMessages().filter(
      (message) => message.action === EXTENSION_MESSAGES.DAPP_RESPONSE,
    );
    expect(
      responses.find((message) => message.requestId === "request-b")?.response,
    ).toEqual({ signature: "0xsecond" });
    expect(
      responses.find((message) => message.requestId === "request-a")?.response,
    ).toEqual({ transactionHash: "0xfirst" });
  });

  it("reports the hash it is about to broadcast (L-4)", async () => {
    const store = buildStore("request-a");
    store.setOnPermissionCallBack(async () => {
      await store.reportPendingTransactionHash("0xdeadbeef");
    });

    await store.onPermission(true);

    expect(sentMessages()).toContainEqual({
      action: EXTENSION_MESSAGES.DAPP_REQUEST_PENDING_TRANSACTION,
      requestId: "request-a",
      transactionHash: "0xdeadbeef",
    });
  });

  it("tells the worker which way the user answered (L-2)", async () => {
    const store = buildStore("request-a");
    store.setOnPermissionCallBack(async () => undefined);

    await store.onPermission(false);

    expect(sentMessages()).toContainEqual({
      action: EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS,
      requestId: "request-a",
      hasApproved: false,
    });
  });

  it("asks the service worker before it does any work (L-2)", async () => {
    const seenBeforeCallback: unknown[] = [];
    const store = buildStore("request-a");
    store.setOnPermissionCallBack(async () => {
      seenBeforeCallback.push(...sentMessages());
    });

    await store.onPermission(true);

    expect(seenBeforeCallback).toEqual([
      {
        action: EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS,
        requestId: "request-a",
        hasApproved: true,
      },
    ]);
  });

  it.each([undefined, { accepted: false }, {}])(
    "does no work when the worker does not acknowledge the request (%s) (L-2)",
    async (ack) => {
      const clear = vi
        .spyOn(StorageUtil, "clearDAppsRequestDataForRequestId")
        .mockResolvedValue(undefined);
      acknowledgeInProgress(ack);
      const callBack = vi.fn().mockResolvedValue(undefined);
      const store = buildStore("request-a");
      store.setOnPermissionCallBack(callBack);

      await store.onPermission(true);

      expect(callBack).not.toHaveBeenCalled();
      expect(sentResponse()).toBeUndefined();
      expect(store.approvalProcessingStatus.isProcessing).toBe(false);
      // The stale prompt is taken off the screen.
      expect(clear).toHaveBeenCalledWith("request-a");
    },
  );

  it("does no work when the acknowledgement cannot be delivered (L-2)", async () => {
    vi.mocked(browser.runtime.sendMessage).mockRejectedValue(
      new Error("Receiving end does not exist"),
    );
    const callBack = vi.fn().mockResolvedValue(undefined);
    const store = buildStore("request-a");
    store.setOnPermissionCallBack(callBack);

    await store.onPermission(true);

    expect(callBack).not.toHaveBeenCalled();
  });

  it("leaves the slot to the service worker on the answered path (L-9)", async () => {
    const clear = vi
      .spyOn(StorageUtil, "clearDAppsRequestDataForRequestId")
      .mockResolvedValue(undefined);
    const store = buildStore("request-a");
    store.setOnPermissionCallBack(async () => undefined);

    await store.onPermission(true);

    // The worker clears it as it takes the answer, which keeps the clear
    // ahead of the next request being written.
    expect(clear).not.toHaveBeenCalled();
  });

  it("clears its own request when the answer cannot be delivered (L-9)", async () => {
    const clear = vi
      .spyOn(StorageUtil, "clearDAppsRequestDataForRequestId")
      .mockResolvedValue(undefined);
    vi.mocked(browser.runtime.sendMessage).mockImplementation(
      async (message: unknown) => {
        const action = (message as { action?: string })?.action;
        if (action === EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS) {
          return { accepted: true };
        }
        throw new Error("Receiving end does not exist");
      },
    );
    const store = buildStore("request-a");
    store.setOnPermissionCallBack(async () => undefined);

    await store.onPermission(true);

    expect(clear).toHaveBeenCalledWith("request-a");
  });

  it("still finishes when the callback throws (M1)", async () => {
    const store = buildStore("request-a");
    store.setOnPermissionCallBack(async () => {
      throw new Error("signing failed");
    });

    await store.onPermission(true);

    expect(store.approvalProcessingStatus).toMatchObject({
      isProcessing: false,
      hasCompleted: true,
    });
  });
});
