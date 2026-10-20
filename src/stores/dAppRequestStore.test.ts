import { profileStorageKey } from "@/utilities/profileStorage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import StorageUtil from "@/utilities/storageUtil";
import DAppRequestStore from "./dAppRequestStore";
import { EXTENSION_MESSAGES } from "@/scripts/constants/streamConstants";
import type { DAppRequestType } from "@/scripts/middlewares/middlewareTypes";
import { isRecord } from "@/utilities/storageGuards";
import { malformed } from "@/test-utils/malformed";

const mockedBrowser = vi.mocked(browser, true);
type ConnectedDApp = Awaited<
  ReturnType<typeof StorageUtil.getDAppsConnectedAccountsData>
>;
const makeTab = (overrides: Partial<browser.Tabs.Tab>): browser.Tabs.Tab => ({
  active: true,
  highlighted: true,
  incognito: false,
  index: 0,
  pinned: false,
  windowId: 1,
  ...overrides,
});

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
    const listener =
      mockedBrowser.storage.onChanged.addListener.mock.calls.at(0)?.[0];

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
    const listener =
      mockedBrowser.storage.onChanged.addListener.mock.calls.at(0)?.[0];

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
    let resolveStaleRequest:
      | ((value: DAppRequestType | undefined) => void)
      | undefined;
    let resolveNewestRequest:
      | ((value: DAppRequestType | undefined) => void)
      | undefined;
    vi.spyOn(StorageUtil, "getDAppsRequestData")
      .mockImplementationOnce(
        () =>
          new Promise<DAppRequestType | undefined>((resolve) => {
            resolveStaleRequest = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<DAppRequestType | undefined>((resolve) => {
            resolveNewestRequest = resolve;
          }),
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
    mockedBrowser.tabs.query.mockResolvedValue([
      makeTab({
        active: true,
        url: "https://connected.example/app",
        title: "Connected",
        favIconUrl: "",
      }),
    ]);
    vi.spyOn(StorageUtil, "getDAppsConnectedAccountsData").mockImplementation(
      (origin) =>
        Promise.resolve(
          origin === "https://connected.example"
            ? {
                urlOrigin: origin,
                accounts: ["QConnected"],
                blockchains: [],
                permissions: [],
              }
            : undefined,
        ),
    );
    const store = new DAppRequestStore();
    await vi.waitFor(() => {
      expect(store.currentTabData?.connectedAccounts).toEqual(["QConnected"]);
    });
    const onActivated =
      mockedBrowser.tabs.onActivated.addListener.mock.calls.at(0)?.[0];
    mockedBrowser.tabs.query.mockResolvedValue([
      makeTab({
        active: true,
        url: "https://disconnected.example/app",
        title: "Disconnected",
        favIconUrl: "",
      }),
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
    mockedBrowser.tabs.query.mockResolvedValue([
      makeTab({
        active: true,
        url: "about:blank",
        title: "New tab",
        favIconUrl: "",
      }),
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
    let resolveConnectedTab: ((value: ConnectedDApp) => void) | undefined;
    mockedBrowser.tabs.query.mockResolvedValue([
      makeTab({
        active: true,
        url: "about:blank",
        title: "New tab",
        favIconUrl: "",
      }),
    ]);
    vi.spyOn(StorageUtil, "getDAppsConnectedAccountsData").mockImplementation(
      (origin) => {
        if (origin === "https://connected.example") {
          return new Promise<ConnectedDApp>((resolve) => {
            resolveConnectedTab = resolve;
          });
        }
        return Promise.resolve({
          urlOrigin: origin ?? "",
          accounts: [],
          blockchains: [],
          permissions: [],
        });
      },
    );
    const store = new DAppRequestStore();
    await vi.waitFor(() => {
      expect(store.currentTabData?.urlOrigin).toBe("");
    });
    mockedBrowser.tabs.query.mockResolvedValue([
      makeTab({
        active: true,
        url: "https://connected.example/app",
        title: "Connected",
        favIconUrl: "",
      }),
    ]);
    const staleFetch = store.fetchCurrentTabData();
    await vi.waitFor(() => {
      expect(resolveConnectedTab).toBeTypeOf("function");
    });
    mockedBrowser.tabs.query.mockResolvedValue([
      makeTab({
        active: true,
        url: "https://disconnected.example/app",
        title: "Disconnected",
        favIconUrl: "",
      }),
    ]);

    await store.fetchCurrentTabData();
    resolveConnectedTab?.({
      urlOrigin: "https://connected.example",
      accounts: ["QStale"],
      blockchains: [],
      permissions: [],
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
    mockedBrowser.runtime.sendMessage.mockImplementation((message: unknown) =>
      Promise.resolve(
        isRecord(message) &&
          message.action === EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS
          ? ack
          : undefined,
      ),
    );
  };

  const sentMessages = () =>
    mockedBrowser.runtime.sendMessage.mock.calls
      .map(([message]): unknown => message)
      .filter(isRecord);

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
    const listener =
      mockedBrowser.storage.onChanged.addListener.mock.calls.at(0)?.[0];
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
    store.setOnPermissionCallBack(() => {
      swapInAnotherRequest(store);
      return Promise.resolve();
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
    store.setOnPermissionCallBack((_hasApproved, record) => {
      swapInAnotherRequest(store);
      record({ transactionHash: "0xabc" });
      return Promise.resolve();
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
    store.setOnPermissionCallBack((_hasApproved, record) => {
      record({ signature: "0xsecond" });
      return Promise.resolve();
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
    store.setOnPermissionCallBack(() => Promise.resolve());

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
    store.setOnPermissionCallBack(() => {
      seenBeforeCallback.push(...sentMessages());
      return Promise.resolve();
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

  it.each([
    undefined,
    null,
    [],
    true,
    { accepted: false },
    { accepted: "true" },
    { accepted: 1 },
    {},
  ])(
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
    mockedBrowser.runtime.sendMessage.mockRejectedValue(
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
    store.setOnPermissionCallBack(() => Promise.resolve());

    await store.onPermission(true);

    // The worker clears it as it takes the answer, which keeps the clear
    // ahead of the next request being written.
    expect(clear).not.toHaveBeenCalled();
  });

  it("clears its own request when the answer cannot be delivered (L-9)", async () => {
    const clear = vi
      .spyOn(StorageUtil, "clearDAppsRequestDataForRequestId")
      .mockResolvedValue(undefined);
    mockedBrowser.runtime.sendMessage.mockImplementation((message: unknown) => {
      if (
        isRecord(message) &&
        message.action === EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS
      ) {
        return Promise.resolve({ accepted: true });
      }
      return Promise.reject(new Error("Receiving end does not exist"));
    });
    const store = buildStore("request-a");
    store.setOnPermissionCallBack(() => Promise.resolve());

    await store.onPermission(true);

    expect(clear).toHaveBeenCalledWith("request-a");
  });

  it("still finishes when the callback throws (M1)", async () => {
    const store = buildStore("request-a");
    store.setOnPermissionCallBack(() =>
      Promise.reject(new Error("signing failed")),
    );

    await store.onPermission(true);

    expect(store.approvalProcessingStatus).toMatchObject({
      isProcessing: false,
      hasCompleted: true,
    });
  });

  it("never answers a dApp with an empty success (R2)", async () => {
    const store = buildStore("request-a", "personal_sign");
    // What the store's no-op default does: a screen whose signing callback
    // was never registered used to leave the bucket empty, and the
    // middleware turned the resulting truthy {} into a success carrying no
    // signature.
    store.setOnPermissionCallBack(() => Promise.resolve());

    await store.onPermission(true);

    const response = sentResponse()?.response;
    if (!isRecord(response) || !isRecord(response.error)) {
      throw new Error("Expected a provider error response");
    }
    expect(response.error.code).toBe(-32603);
    expect(response.error.message).toContain("produced no result");
  });

  it("leaves a result the approval did produce alone", async () => {
    const store = buildStore("request-a", "personal_sign");
    store.setOnPermissionCallBack((_hasApproved, record) => {
      record({ signature: "0xsigned" });
      return Promise.resolve();
    });

    await store.onPermission(true);

    expect(sentResponse()?.response).toEqual({ signature: "0xsigned" });
  });

  it("leaves an account approval that answered from responseData alone", async () => {
    const store = buildStore("request-a", "qrl_requestAccounts");
    store.addToResponseData({ accounts: ["QChosen"] });
    store.setOnPermissionCallBack(() => Promise.resolve());

    await store.onPermission(true);

    expect(sentResponse()?.response).toEqual({ accounts: ["QChosen"] });
  });

  it("adds nothing to a rejection", async () => {
    const store = buildStore("request-a", "personal_sign");
    store.setOnPermissionCallBack(() => Promise.resolve());

    await store.onPermission(false);

    expect(sentResponse()?.response).toEqual({});
  });

  it("serializes recorded results for the clicked request", async () => {
    const store = buildStore("request-a");
    store.setOnPermissionCallBack((_approved, record) => {
      record({ nonce: 12n, transactionHash: "0xhash" });
      return Promise.resolve();
    });
    await store.onPermission(true);
    expect(sentResponse()?.response).toEqual({
      nonce: "0xc",
      transactionHash: "0xhash",
    });
  });

  it("handles a malformed recorded result through the approval error path", async () => {
    const clear = vi
      .spyOn(StorageUtil, "clearDAppsRequestDataForRequestId")
      .mockResolvedValue();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = buildStore("request-a");
    store.setOnPermissionCallBack((_approved, record) => {
      record({ toJSON: () => null });
      return Promise.resolve();
    });
    await store.onPermission(true);
    expect(sentResponse()).toBeUndefined();
    expect(clear).toHaveBeenCalledWith("request-a");
    expect(warn).toHaveBeenCalledWith(
      "QrlWeb3Wallet: Error while resolving the permission request\n",
      new Error("Invalid dApp response data"),
    );
    expect(store.approvalProcessingStatus.hasCompleted).toBe(true);
  });

  it("reports rejected status updates without losing the approval response", async () => {
    const failure = new Error("Status update failed");
    vi.spyOn(
      DAppRequestStore.prototype,
      "setApprovalProcessingStatus",
    ).mockRejectedValue(failure);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = buildStore("request-a");
    store.addToResponseData({ signature: "0xsigned" });
    await store.onPermission(true);
    expect(sentResponse()?.response).toEqual({ signature: "0xsigned" });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(
      "QrlWeb3Wallet: Failed to update approval status",
      failure,
    );
  });

  it("applies status synchronously and retains its resolved Promise result", async () => {
    const store = buildStore("request-a");
    const update = store.setApprovalProcessingStatus({
      isProcessing: true,
      hasApproved: true,
    });
    expect(store.approvalProcessingStatus).toEqual({
      isProcessing: true,
      hasApproved: true,
      hasCompleted: false,
    });
    await expect(update).resolves.toBeUndefined();
  });
});

describe("DAppRequestStore boundaries", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { method: 1 },
    { method: "personal_sign", requestId: 2 },
    { method: "personal_sign", authorizedChainId: false },
    { method: "personal_sign", requestData: { senderData: { url: 1 } } },
    { method: "personal_sign", requestData: { senderData: { tabId: "one" } } },
    { method: "personal_sign", phishingResult: { isDomainPhishing: "false" } },
    {
      method: "personal_sign",
      phishingResult: { isDomainPhishing: false, detectorStatus: "unknown" },
    },
  ])(
    "rejects malformed stored request metadata without writing storage: %j",
    async (value) => {
      vi.spyOn(
        DAppRequestStore.prototype,
        "fetchCurrentTabData",
      ).mockResolvedValue();
      vi.spyOn(StorageUtil, "getDAppsRequestData").mockResolvedValue(
        malformed<DAppRequestType | undefined>(value),
      );
      const store = new DAppRequestStore();
      store.dAppRequestData = {
        method: "personal_sign",
        requestId: "previous",
      };

      await store.readDAppRequestData();

      expect(store.hasDAppRequest).toBe(false);
      expect(mockedBrowser.storage.session.set.mock.calls).toHaveLength(0);
      expect(mockedBrowser.storage.session.remove.mock.calls).toHaveLength(0);
      expect(mockedBrowser.storage.local.set.mock.calls).toHaveLength(0);
    },
  );

  it("retains valid request fields and legacy requests with no id", async () => {
    vi.spyOn(
      DAppRequestStore.prototype,
      "fetchCurrentTabData",
    ).mockResolvedValue();
    const request: DAppRequestType = {
      method: "personal_sign",
      params: ["message", "account"],
      authorizedChainId: "0x1",
      requestData: {
        senderData: { url: "https://dapp.example", tabId: 1, title: "dApp" },
      },
      phishingResult: {
        isDomainPhishing: false,
        detectorStatus: "ready",
        matchType: "allowlist",
        matchedDomain: "dapp.example",
      },
    };
    vi.spyOn(StorageUtil, "getDAppsRequestData").mockResolvedValue(request);
    const store = new DAppRequestStore();
    await store.readDAppRequestData();
    expect(store.dAppRequestData).toEqual(request);
  });

  it("reports rejected tab refreshes from construction and browser events", async () => {
    const failure = new Error("Tabs unavailable");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi
      .spyOn(DAppRequestStore.prototype, "fetchCurrentTabData")
      .mockRejectedValue(failure);
    new DAppRequestStore();
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledTimes(1);
    });
    const activated =
      mockedBrowser.tabs.onActivated.addListener.mock.calls.at(0)?.[0];
    const updated =
      mockedBrowser.tabs.onUpdated.addListener.mock.calls.at(0)?.[0];
    const changed =
      mockedBrowser.storage.onChanged.addListener.mock.calls.at(0)?.[0];
    if (!activated || !updated || !changed)
      throw new Error("Expected browser listeners");
    activated({ tabId: 1, windowId: 1 });
    updated(1, { status: "complete" }, makeTab({}));
    changed({ [profileStorageKey("DAPPS")]: { newValue: {} } }, "local");
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledTimes(4);
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenLastCalledWith(
      "QrlWeb3Wallet: Failed to refresh the active dApp",
      failure,
    );
  });

  it("reports rejected request reads from storage events", async () => {
    vi.spyOn(
      DAppRequestStore.prototype,
      "fetchCurrentTabData",
    ).mockResolvedValue();
    const failure = new Error("Storage unavailable");
    vi.spyOn(StorageUtil, "getDAppsRequestData").mockRejectedValue(failure);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new DAppRequestStore();
    const listener =
      mockedBrowser.storage.onChanged.addListener.mock.calls.at(0)?.[0];
    if (!listener) throw new Error("Expected storage listener");
    listener({ [profileStorageKey("DAPPS")]: { newValue: {} } }, "session");
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        "QrlWeb3Wallet: Failed to read the dApp request",
        failure,
      );
    });
  });

  it("handles an empty active-tab list", async () => {
    mockedBrowser.tabs.query.mockResolvedValueOnce([]);
    const store = new DAppRequestStore();
    await vi.waitFor(() => {
      expect(store.currentTabData).toEqual({
        favIconUrl: "",
        title: "",
        urlOrigin: "",
        connectedAccounts: [],
        connectedBlockchains: [],
      });
    });
  });

  it("preserves serialized approval fields and rejects a non-record result", () => {
    vi.spyOn(
      DAppRequestStore.prototype,
      "fetchCurrentTabData",
    ).mockResolvedValue();
    const store = new DAppRequestStore();
    store.addToResponseData({
      nonce: 12n,
      nested: { value: 15n },
      retained: true,
    });
    expect(store.responseData).toEqual({
      nonce: "0xc",
      nested: { value: "0xf" },
      retained: true,
    });
    expect(() => {
      store.addToResponseData({ toJSON: () => ["invalid"] });
    }).toThrow("Invalid dApp response data");
    expect(store.responseData).toEqual({
      nonce: "0xc",
      nested: { value: "0xf" },
      retained: true,
    });
  });
});
