import { WindowPostMessageStream } from "@theqrl/qrl-wallet-provider/post-message-stream";
import { Duplex } from "readable-stream";
import { describe, expect, it, vi } from "vitest";
import {
  createProviderChannelBridge,
  createProviderStreamFailureGuard,
  initializeContentScriptProviderConnection,
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

  it("replays each pending ID once on the replacement generation", async () => {
    const page = new ProbeChannel();
    const firstExtension = new ProbeChannel();
    const bridge = createProviderChannelBridge(page);
    const disconnectFirst = bridge.attachExtensionChannel(firstExtension);
    expect(bridge.markConnectionReady()).toBe(0);

    const beforeDisconnect = {
      jsonrpc: "2.0",
      id: 1,
      method: "beforeDisconnect",
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
      method: "duringDisconnect",
    };
    page.emitInbound(duringDisconnect);
    const secondExtension = new ProbeChannel();
    const disconnectSecond = bridge.attachExtensionChannel(secondExtension);
    const beforeReady = {
      jsonrpc: "2.0",
      id: 3,
      method: "beforeReady",
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
