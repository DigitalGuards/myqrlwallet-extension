import { WindowPostMessageStream } from "@theqrl/qrl-wallet-provider/post-message-stream";
import { Duplex } from "readable-stream";
import { describe, expect, it, vi } from "vitest";
import { RESTRICTED_METHODS } from "../constants/requestConstants";
import {
  createProviderChannelBridge,
  createProviderStreamFailureGuard,
  initializeContentScriptProviderConnection,
  MAX_PENDING_REQUESTS,
  PENDING_REQUEST_TTL_MS,
  REPLAY_SAFE_METHODS,
} from "./providerConnectionLifecycle";

class ProbeChannel extends Duplex {
  readonly writes: unknown[] = [];

  constructor() {
    super({ objectMode: true });
  }

  _read() {}

  _write(
    chunk: unknown,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.writes.push(chunk);
    callback();
  }

  emitInbound(message: unknown) {
    this.push(message);
  }
}

const waitForBufferedRequest = async (suffix: string) => {
  const postMessage = vi
    .spyOn(window, "postMessage")
    .mockImplementation((message, targetOrigin) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: message,
          origin: String(targetOrigin),
          source: window,
        }),
      );
    });
  const inpage = new WindowPostMessageStream({
    name: `inpage-${suffix}`,
    target: `content-${suffix}`,
  });
  const request = {
    jsonrpc: "2.0",
    id: 42,
    method: "qrlWallet_getProviderState",
  };
  const received: (typeof request)[] = [];

  let content: WindowPostMessageStream | undefined;
  try {
    inpage.write(request);
    content = new WindowPostMessageStream({
      name: `content-${suffix}`,
      target: `inpage-${suffix}`,
    });
    content.on("data", (message) => received.push(message));

    await vi.waitFor(() => expect(received).toEqual([request]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(received).toEqual([request]);
  } finally {
    inpage.destroy();
    content?.destroy();
    postMessage.mockRestore();
  }
};

describe("initializeContentScriptProviderConnection", () => {
  it("delivers a provider request once when inpage starts before the content bridge", async () => {
    await waitForBufferedRequest("initial");
  });

  it("delivers a provider request once after both document streams reload", async () => {
    await waitForBufferedRequest("before-reload");
    await waitForBufferedRequest("after-reload");
  });

  it("installs the provider port listener before waiting for tab announcements", async () => {
    let resolveTabsQuery: (() => void) | undefined;
    const tabsQuery = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTabsQuery = resolve;
        }),
    );
    const port = {
      onMessage: { addListener: vi.fn() },
    };
    const setupConnection = vi.fn(async (providerPort: typeof port) => {
      providerPort.onMessage.addListener(() => undefined);
    });
    const announceReady = vi.fn(async () => {
      await tabsQuery();
    });

    const connection = initializeContentScriptProviderConnection(
      port,
      setupConnection,
      announceReady,
    );

    await vi.waitFor(() => expect(tabsQuery).toHaveBeenCalledOnce());
    expect(port.onMessage.addListener).toHaveBeenCalledOnce();

    resolveTabsQuery?.();
    await connection;
  });

  it("handles the first provider request once while the ready announcement is pending", async () => {
    let receiveRequest: ((request: { id: number }) => void) | undefined;
    let resolveAnnouncement: (() => void) | undefined;
    const handledRequestIds: number[] = [];
    const port = {
      onMessage: {
        addListener: vi.fn((listener: (request: { id: number }) => void) => {
          receiveRequest = listener;
        }),
      },
    };
    const setupConnection = vi.fn(async (providerPort: typeof port) => {
      providerPort.onMessage.addListener((request) => {
        handledRequestIds.push(request.id);
      });
    });
    const announceReady = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAnnouncement = resolve;
        }),
    );

    const connection = initializeContentScriptProviderConnection(
      port,
      setupConnection,
      announceReady,
    );

    await vi.waitFor(() => expect(announceReady).toHaveBeenCalledOnce());
    receiveRequest?.({ id: 42 });
    expect(handledRequestIds).toEqual([42]);

    resolveAnnouncement?.();
    await connection;
    expect(handledRequestIds).toEqual([42]);
  });
});

describe("createProviderStreamFailureGuard", () => {
  it("suppresses permanent failure when port disconnect runs after pipeline close", async () => {
    const notifyInpage = vi.fn();
    const guard = createProviderStreamFailureGuard(1, () => 1, notifyInpage);

    guard.handlePipelineClose();
    guard.markPortDisconnected();
    await Promise.resolve();

    expect(notifyInpage).not.toHaveBeenCalled();
  });

  it("notifies only for a nonrecoverable close in the current generation", async () => {
    let currentGeneration = 1;
    const notifyInpage = vi.fn();
    const currentGuard = createProviderStreamFailureGuard(
      1,
      () => currentGeneration,
      notifyInpage,
    );
    currentGuard.handlePipelineClose();
    await Promise.resolve();
    expect(notifyInpage).toHaveBeenCalledOnce();

    const staleGuard = createProviderStreamFailureGuard(
      1,
      () => currentGeneration,
      notifyInpage,
    );
    currentGeneration = 2;
    staleGuard.handlePipelineClose();
    await Promise.resolve();
    expect(notifyInpage).toHaveBeenCalledOnce();
  });
});

describe("createProviderChannelBridge", () => {
  it("keeps bidirectional page traffic usable across extension generations", async () => {
    const page = new ProbeChannel();
    const firstExtension = new ProbeChannel();
    const bridge = createProviderChannelBridge(page);
    const disconnectFirst = bridge.attachExtensionChannel(firstExtension);
    expect(bridge.markConnectionReady()).toBe(0);

    page.emitInbound({ jsonrpc: "2.0", id: 1, method: "first" });
    await vi.waitFor(() =>
      expect(firstExtension.writes).toEqual([
        { jsonrpc: "2.0", id: 1, method: "first" },
      ]),
    );
    firstExtension.emitInbound({ id: 1, result: "first" });
    await vi.waitFor(() =>
      expect(page.writes).toEqual([{ id: 1, result: "first" }]),
    );
    disconnectFirst();
    firstExtension.destroy();

    expect(page.destroyed).toBe(false);
    expect(page.readable).toBe(true);
    expect(page.writable).toBe(true);

    const secondExtension = new ProbeChannel();
    const disconnectSecond = bridge.attachExtensionChannel(secondExtension);
    expect(bridge.markConnectionReady()).toBe(0);
    page.emitInbound({ jsonrpc: "2.0", id: 2, method: "second" });
    await vi.waitFor(() =>
      expect(secondExtension.writes).toEqual([
        { jsonrpc: "2.0", id: 2, method: "second" },
      ]),
    );
    secondExtension.emitInbound({ id: 2, result: "second" });
    await vi.waitFor(() =>
      expect(page.writes).toEqual([
        { id: 1, result: "first" },
        { id: 2, result: "second" },
      ]),
    );

    disconnectSecond();
    secondExtension.destroy();
    bridge.destroy();
    page.destroy();
  });

  it("replays each pending read ID once on the replacement generation", async () => {
    const page = new ProbeChannel();
    const firstExtension = new ProbeChannel();
    const bridge = createProviderChannelBridge(page);
    const disconnectFirst = bridge.attachExtensionChannel(firstExtension);
    expect(bridge.markConnectionReady()).toBe(0);

    const beforeDisconnect = {
      jsonrpc: "2.0",
      id: 1,
      method: "qrl_blockNumber",
    };
    page.emitInbound(beforeDisconnect);
    await vi.waitFor(() =>
      expect(firstExtension.writes).toEqual([beforeDisconnect]),
    );
    disconnectFirst();
    firstExtension.destroy();

    const duringDisconnect = {
      jsonrpc: "2.0",
      id: 2,
      method: "qrl_chainId",
    };
    page.emitInbound(duringDisconnect);
    const secondExtension = new ProbeChannel();
    const disconnectSecond = bridge.attachExtensionChannel(secondExtension);
    const beforeReady = {
      jsonrpc: "2.0",
      id: 3,
      method: "qrl_getBalance",
    };
    page.emitInbound(beforeReady);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondExtension.writes).toEqual([]);

    expect(bridge.markConnectionReady()).toBe(3);
    expect(secondExtension.writes).toEqual([
      beforeDisconnect,
      duringDisconnect,
      beforeReady,
    ]);
    expect(bridge.markConnectionReady()).toBe(0);

    secondExtension.emitInbound({ id: 1, result: "old" });
    secondExtension.emitInbound({ id: 2, result: "gap" });
    secondExtension.emitInbound({ id: 3, result: "new" });
    await vi.waitFor(() =>
      expect(page.writes).toEqual([
        { id: 1, result: "old" },
        { id: 2, result: "gap" },
        { id: 3, result: "new" },
      ]),
    );
    expect(bridge.markConnectionReady()).toBe(0);

    disconnectSecond();
    secondExtension.destroy();
    bridge.destroy();
    page.destroy();
  });

  it("answers a forwarded state-changing request with the reset error", async () => {
    const page = new ProbeChannel();
    const firstExtension = new ProbeChannel();
    const bridge = createProviderChannelBridge(page);
    const disconnectFirst = bridge.attachExtensionChannel(firstExtension);
    expect(bridge.markConnectionReady()).toBe(0);

    const broadcast = {
      jsonrpc: "2.0",
      id: "tx",
      method: "qrl_sendRawTransaction",
      params: ["0xdeadbeef"],
    };
    const approval = {
      jsonrpc: "2.0",
      id: 7,
      method: "qrl_sendTransaction",
      params: [{ value: "0x1" }],
    };
    const read = { jsonrpc: "2.0", id: 8, method: "qrl_getTransactionCount" };
    page.emitInbound(broadcast);
    page.emitInbound(approval);
    page.emitInbound(read);
    await vi.waitFor(() =>
      expect(firstExtension.writes).toEqual([broadcast, approval, read]),
    );

    disconnectFirst();
    firstExtension.destroy();
    const secondExtension = new ProbeChannel();
    const disconnectSecond = bridge.attachExtensionChannel(secondExtension);

    // Only the read is safe to run again; the other two already reached the
    // service worker and may have completed while the port was down.
    expect(bridge.markConnectionReady()).toBe(1);
    expect(secondExtension.writes).toEqual([read]);
    expect(page.writes).toEqual([
      {
        jsonrpc: "2.0",
        id: "tx",
        error: {
          code: -32603,
          message: "Connection to the wallet was reset; please retry",
        },
      },
      {
        jsonrpc: "2.0",
        id: 7,
        error: {
          code: -32603,
          message: "Connection to the wallet was reset; please retry",
        },
      },
    ]);

    // A late answer for a locally settled request must never reach the page
    // a second time.
    secondExtension.emitInbound({ jsonrpc: "2.0", id: "tx", result: "0xhash" });
    secondExtension.emitInbound({ jsonrpc: "2.0", id: 8, result: "0x2" });
    await vi.waitFor(() => expect(page.writes).toHaveLength(3));
    expect(page.writes[2]).toEqual({ jsonrpc: "2.0", id: 8, result: "0x2" });

    disconnectSecond();
    secondExtension.destroy();
    bridge.destroy();
    page.destroy();
  });

  it("replays a request the service worker never received whatever its method", async () => {
    const page = new ProbeChannel();
    const extension = new ProbeChannel();
    const bridge = createProviderChannelBridge(page);
    const disconnect = bridge.attachExtensionChannel(extension);
    const approval = {
      jsonrpc: "2.0",
      id: "never-sent",
      method: "qrl_sendTransaction",
    };

    page.emitInbound(approval);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(extension.writes).toEqual([]);

    expect(bridge.markConnectionReady()).toBe(1);
    expect(extension.writes).toEqual([approval]);
    expect(page.writes).toEqual([]);

    disconnect();
    extension.destroy();
    bridge.destroy();
    page.destroy();
  });

  it("pins the replay-safe method set so a new unrestricted method is classified", () => {
    expect([...REPLAY_SAFE_METHODS].sort()).toEqual(
      [
        "net_version",
        "qrlWallet_getProviderState",
        "qrl_accounts",
        "qrl_blockNumber",
        "qrl_call",
        "qrl_chainId",
        "qrl_estimateGas",
        "qrl_feeHistory",
        "qrl_gasPrice",
        "qrl_getBalance",
        "qrl_getBlockByHash",
        "qrl_getBlockByNumber",
        "qrl_getBlockTransactionCountByHash",
        "qrl_getBlockTransactionCountByNumber",
        "qrl_getCode",
        "qrl_getFilterLogs",
        "qrl_getLogs",
        "qrl_getProof",
        "qrl_getStorageAt",
        "qrl_getTransactionByBlockHashAndIndex",
        "qrl_getTransactionByBlockNumberAndIndex",
        "qrl_getTransactionByHash",
        "qrl_getTransactionCount",
        "qrl_getTransactionReceipt",
        "qrl_syncing",
        "qrl_walletCapabilities",
        "wallet_getPermissions",
        "web3_clientVersion",
      ].sort(),
    );
    for (const method of Object.values(RESTRICTED_METHODS)) {
      expect(REPLAY_SAFE_METHODS.has(method)).toBe(false);
    }
  });

  it("settles the oldest pending requests once the cap is passed", async () => {
    const page = new ProbeChannel();
    const extension = new ProbeChannel();
    const bridge = createProviderChannelBridge(page);
    const disconnect = bridge.attachExtensionChannel(extension);

    for (let index = 0; index <= MAX_PENDING_REQUESTS; index += 1) {
      page.emitInbound({
        jsonrpc: "2.0",
        id: index,
        method: "qrl_blockNumber",
      });
    }
    await vi.waitFor(() => expect(page.writes).toHaveLength(1));
    expect(page.writes[0]).toEqual({
      jsonrpc: "2.0",
      id: 0,
      error: {
        code: -32603,
        message: "Connection to the wallet was reset; please retry",
      },
    });
    // The capped request is gone, so only the survivors are replayed.
    expect(bridge.markConnectionReady()).toBe(MAX_PENDING_REQUESTS);

    disconnect();
    extension.destroy();
    bridge.destroy();
    page.destroy();
  });

  it("refuses the newest request when every pending one is live", async () => {
    const page = new ProbeChannel();
    const extension = new ProbeChannel();
    const bridge = createProviderChannelBridge(page);
    const disconnect = bridge.attachExtensionChannel(extension);
    expect(bridge.markConnectionReady()).toBe(0);

    // Every request here reaches the live connection, so the oldest is an
    // approval the wallet is still working on. Settling that one would
    // answer the dApp with an error while the wallet completes it.
    for (let index = 0; index <= MAX_PENDING_REQUESTS; index += 1) {
      page.emitInbound({
        jsonrpc: "2.0",
        id: index,
        method: index === 0 ? "qrl_sendTransaction" : "qrl_blockNumber",
      });
    }
    // The live connection is piped straight through, so the request that
    // broke the cap still reaches the worker. What the cap decides is which
    // request the page is told about, and that is the newest one.
    await vi.waitFor(() =>
      expect(extension.writes).toHaveLength(MAX_PENDING_REQUESTS + 1),
    );

    expect(page.writes).toEqual([
      {
        jsonrpc: "2.0",
        id: MAX_PENDING_REQUESTS,
        error: {
          code: -32603,
          message: "Connection to the wallet was reset; please retry",
        },
      },
    ]);
    // The long-running approval is untouched and still answerable.
    extension.emitInbound({ jsonrpc: "2.0", id: 0, result: "0xhash" });
    await vi.waitFor(() => expect(page.writes).toHaveLength(2));
    expect(page.writes[1]).toEqual({
      jsonrpc: "2.0",
      id: 0,
      result: "0xhash",
    });

    disconnect();
    extension.destroy();
    bridge.destroy();
    page.destroy();
  });

  it("stays quiet when the page stream is gone before a request is settled", async () => {
    const page = new ProbeChannel();
    const firstExtension = new ProbeChannel();
    const bridge = createProviderChannelBridge(page);
    const disconnectFirst = bridge.attachExtensionChannel(firstExtension);
    expect(bridge.markConnectionReady()).toBe(0);

    const broadcast = {
      jsonrpc: "2.0",
      id: "tx",
      method: "qrl_sendRawTransaction",
    };
    page.emitInbound(broadcast);
    await vi.waitFor(() => expect(firstExtension.writes).toEqual([broadcast]));

    disconnectFirst();
    firstExtension.destroy();
    page.destroy();

    const secondExtension = new ProbeChannel();
    const disconnectSecond = bridge.attachExtensionChannel(secondExtension);
    expect(() => bridge.markConnectionReady()).not.toThrow();

    disconnectSecond();
    secondExtension.destroy();
    bridge.destroy();
  });

  it("settles a request orphaned for longer than the pending TTL", async () => {
    const page = new ProbeChannel();
    const extension = new ProbeChannel();
    const bridge = createProviderChannelBridge(page);
    const disconnect = bridge.attachExtensionChannel(extension);
    const orphan = {
      jsonrpc: "2.0",
      id: "orphan",
      method: "qrl_blockNumber",
    };
    page.emitInbound(orphan);
    // The bridge records a request on the stream's data event, so the clock
    // may only move once that has actually happened.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(page.writes).toEqual([]);

    const clock = vi.spyOn(Date, "now");
    try {
      clock.mockReturnValue(Date.now() + PENDING_REQUEST_TTL_MS + 1);
      page.emitInbound({ jsonrpc: "2.0", id: "fresh", method: "qrl_chainId" });
      await vi.waitFor(() => expect(page.writes).toHaveLength(1));
      expect(page.writes[0]).toEqual({
        jsonrpc: "2.0",
        id: "orphan",
        error: {
          code: -32603,
          message: "Connection to the wallet was reset; please retry",
        },
      });
      expect(bridge.markConnectionReady()).toBe(1);
      expect(extension.writes).toEqual([
        { jsonrpc: "2.0", id: "fresh", method: "qrl_chainId" },
      ]);
    } finally {
      clock.mockRestore();
      disconnect();
      extension.destroy();
      bridge.destroy();
      page.destroy();
    }
  });

  it("answers every waiting request with 4900 once the extension is gone, and serves nothing after", async () => {
    const page = new ProbeChannel();
    const extension = new ProbeChannel();
    const bridge = createProviderChannelBridge(page);
    bridge.attachExtensionChannel(extension);
    page.emitInbound({ jsonrpc: "2.0", id: "waiting", method: "qrl_requestAccounts" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(page.writes).toEqual([]);

    try {
      bridge.disconnectPermanently();
      expect(page.writes).toEqual([
        {
          jsonrpc: "2.0",
          id: "waiting",
          error: {
            code: 4900,
            message:
              "The wallet extension was updated or removed; reload this page to reconnect",
          },
        },
      ]);

      page.emitInbound({ jsonrpc: "2.0", id: "late", method: "qrl_chainId" });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(page.writes).toHaveLength(1);
      expect(extension.writes).toEqual([]);
    } finally {
      extension.destroy();
      page.destroy();
    }
  });

  it("does not replay an already forwarded request on a fresh connection", async () => {
    const page = new ProbeChannel();
    const extension = new ProbeChannel();
    const bridge = createProviderChannelBridge(page);
    const disconnect = bridge.attachExtensionChannel(extension);
    const request = { jsonrpc: "2.0", id: "fresh", method: "fresh" };

    page.emitInbound(request);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(extension.writes).toEqual([]);
    expect(bridge.markConnectionReady()).toBe(1);
    expect(bridge.markConnectionReady()).toBe(0);
    expect(extension.writes).toEqual([request]);

    disconnect();
    extension.destroy();
    bridge.destroy();
    page.destroy();
  });

  it("drops stale responses and forwards one response for each known ID", async () => {
    const page = new ProbeChannel();
    const extension = new ProbeChannel();
    const bridge = createProviderChannelBridge(page);
    const disconnect = bridge.attachExtensionChannel(extension);
    expect(bridge.markConnectionReady()).toBe(0);

    page.emitInbound({ jsonrpc: "2.0", id: 0, method: "zero" });
    page.emitInbound({ jsonrpc: "2.0", id: "0", method: "string-zero" });
    await vi.waitFor(() => expect(extension.writes).toHaveLength(2));

    extension.emitInbound({ jsonrpc: "2.0", id: 0, result: "number" });
    extension.emitInbound({ jsonrpc: "2.0", id: 0, result: "duplicate" });
    extension.emitInbound({
      jsonrpc: "2.0",
      id: "0",
      error: { code: -1, message: "string" },
    });
    extension.emitInbound({ jsonrpc: "2.0", id: 99, result: "unknown" });
    extension.emitInbound({
      jsonrpc: "2.0",
      method: "qrlWeb3Wallet_chainChanged",
      params: ["0x539"],
    });
    await vi.waitFor(() =>
      expect(page.writes).toEqual([
        { jsonrpc: "2.0", id: 0, result: "number" },
        {
          jsonrpc: "2.0",
          id: "0",
          error: { code: -1, message: "string" },
        },
        {
          jsonrpc: "2.0",
          method: "qrlWeb3Wallet_chainChanged",
          params: ["0x539"],
        },
      ]),
    );

    disconnect();
    extension.destroy();
    bridge.destroy();
    page.destroy();
  });
});
