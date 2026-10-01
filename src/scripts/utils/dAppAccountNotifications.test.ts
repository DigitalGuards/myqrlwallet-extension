import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StorageUtil from "@/utilities/storageUtil";
import {
  notifyDAppAccountsChanged,
  notifyDAppChainChanged,
  registerDAppAccountNotificationStream,
  setWalletLockedForDAppNotifications,
} from "./dAppAccountNotifications";

const dAppsStorage = (accountsByOrigin: Record<string, string[]>) => ({
  ALL_DAPPS: Object.fromEntries(
    Object.entries(accountsByOrigin).map(([urlOrigin, accounts]) => [
      urlOrigin,
      { urlOrigin, accounts },
    ]),
  ),
});

describe("dApp account notifications", () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    setWalletLockedForDAppNotifications(false);
  });

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  const register = (origin: string) => {
    const stream = { write: vi.fn() };
    cleanups.push(registerDAppAccountNotificationStream({ origin }, stream));
    return stream;
  };

  it("emits an account update only to streams from the changed origin", () => {
    const alpha = register("https://alpha.example/path");
    const beta = register("https://beta.example/path");

    notifyDAppAccountsChanged({
      oldValue: dAppsStorage({
        "https://alpha.example": [],
        "https://beta.example": ["Qbeta"],
      }),
      newValue: dAppsStorage({
        "https://alpha.example": ["QAlpha"],
        "https://beta.example": ["Qbeta"],
      }),
    });

    expect(alpha.write).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      method: "qrlWallet_accountsChanged",
      params: ["QAlpha"],
    });
    expect(beta.write).not.toHaveBeenCalled();
  });

  it("emits an empty account list when an origin is removed", () => {
    const stream = register("https://dapp.example");

    notifyDAppAccountsChanged({
      oldValue: dAppsStorage({ "https://dapp.example": ["QAccount"] }),
      newValue: dAppsStorage({}),
    });

    expect(stream.write).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      method: "qrlWallet_accountsChanged",
      params: [],
    });
  });

  it("stops notifications after the provider stream disconnects", () => {
    const stream = { write: vi.fn() };
    const cleanup = registerDAppAccountNotificationStream(
      { origin: "https://dapp.example" },
      stream,
    );
    cleanup();

    notifyDAppAccountsChanged({
      oldValue: dAppsStorage({}),
      newValue: dAppsStorage({ "https://dapp.example": ["QAccount"] }),
    });

    expect(stream.write).not.toHaveBeenCalled();
  });

  it.each([
    { origin: "null", url: "https://fallback.example/frame" },
    { origin: "not an origin", url: "https://fallback.example/frame" },
    { url: "about:blank" },
    { url: "file:///tmp/dapp.html" },
  ])("rejects opaque or malformed sender identity %#", async (sender) => {
    const stream = { write: vi.fn() };
    registerDAppAccountNotificationStream(sender, stream);

    notifyDAppAccountsChanged({
      oldValue: dAppsStorage({}),
      newValue: dAppsStorage({
        "https://fallback.example": ["QAccount"],
        null: ["QOpaque"],
      }),
    });

    expect(stream.write).not.toHaveBeenCalled();
  });

  it("does not emit when the account list is unchanged", () => {
    const stream = register("https://dapp.example");
    const accounts = ["QAccount"];

    notifyDAppAccountsChanged({
      oldValue: dAppsStorage({ "https://dapp.example": accounts }),
      newValue: dAppsStorage({ "https://dapp.example": accounts }),
    });

    expect(stream.write).not.toHaveBeenCalled();
  });

  it("emits the real account list while the wallet is unlocked (F8)", () => {
    setWalletLockedForDAppNotifications(false);
    const stream = register("https://dapp.example");

    notifyDAppAccountsChanged({
      oldValue: dAppsStorage({ "https://dapp.example": [] }),
      newValue: dAppsStorage({ "https://dapp.example": ["QAccount"] }),
    });

    expect(stream.write).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      method: "qrlWallet_accountsChanged",
      params: ["QAccount"],
    });
  });

  it("emits an empty account list while the wallet is locked (F8)", () => {
    setWalletLockedForDAppNotifications(true);
    const stream = register("https://dapp.example");

    notifyDAppAccountsChanged({
      oldValue: dAppsStorage({ "https://dapp.example": [] }),
      newValue: dAppsStorage({ "https://dapp.example": ["QAccount"] }),
    });

    expect(stream.write).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      method: "qrlWallet_accountsChanged",
      params: [],
    });
  });

  it("stays silent for an unchanged origin while locked (F8)", () => {
    setWalletLockedForDAppNotifications(true);
    const stream = register("https://dapp.example");
    const accounts = ["QAccount"];

    notifyDAppAccountsChanged({
      oldValue: dAppsStorage({ "https://dapp.example": accounts }),
      newValue: dAppsStorage({ "https://dapp.example": accounts }),
    });

    expect(stream.write).not.toHaveBeenCalled();
  });
});

describe("dApp account notifications lock mirror", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    setWalletLockedForDAppNotifications(false);
  });

  it("starts out locked so a fresh worker never leaks accounts (F8)", async () => {
    // A freshly evaluated module has no keys in memory. Re-import it to
    // observe the state the service worker starts in.
    vi.resetModules();
    const fresh = await import("./dAppAccountNotifications");
    const stream = { write: vi.fn() };
    cleanups.push(
      fresh.registerDAppAccountNotificationStream(
        { origin: "https://dapp.example" },
        stream,
      ),
    );

    fresh.notifyDAppAccountsChanged({
      oldValue: dAppsStorage({}),
      newValue: dAppsStorage({ "https://dapp.example": ["QAccount"] }),
    });

    expect(stream.write).toHaveBeenCalledWith(
      expect.objectContaining({ params: [] }),
    );
  });
});

describe("dApp account notifications on lock transitions (L-6)", () => {
  const cleanups: Array<() => void> = [];
  const ORIGIN = "https://dapp.example";

  beforeEach(() => {
    setWalletLockedForDAppNotifications(false);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    setWalletLockedForDAppNotifications(false);
  });

  const register = () => {
    const stream = { write: vi.fn() };
    cleanups.push(
      registerDAppAccountNotificationStream({ origin: ORIGIN }, stream),
    );
    return stream;
  };

  it("takes the accounts away from a connected page when the wallet locks", async () => {
    const stream = register();

    setWalletLockedForDAppNotifications(true);

    await vi.waitFor(() => {
      expect(stream.write).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "qrlWallet_accountsChanged",
          params: [],
        }),
      );
    });
  });

  it("hands the granted accounts back when the wallet unlocks", async () => {
    setWalletLockedForDAppNotifications(true);
    const stream = register();
    vi.spyOn(StorageUtil, "getDAppsConnectedAccountsData").mockResolvedValue({
      urlOrigin: ORIGIN,
      accounts: ["QAccount"],
      blockchains: [],
      permissions: [],
    } as never);

    setWalletLockedForDAppNotifications(false);

    await vi.waitFor(() => {
      expect(stream.write).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "qrlWallet_accountsChanged",
          params: ["QAccount"],
        }),
      );
    });
  });

  it("emits nothing when the lock state is set to what it already was", async () => {
    const stream = register();

    setWalletLockedForDAppNotifications(false);
    await Promise.resolve();

    expect(stream.write).not.toHaveBeenCalled();
  });

  it("treats an unreadable grant as no accounts on unlock", async () => {
    setWalletLockedForDAppNotifications(true);
    const stream = register();
    vi.spyOn(StorageUtil, "getDAppsConnectedAccountsData").mockRejectedValue(
      new Error("storage unavailable"),
    );

    setWalletLockedForDAppNotifications(false);

    await vi.waitFor(() => {
      expect(stream.write).toHaveBeenCalledWith(
        expect.objectContaining({ params: [] }),
      );
    });
  });
});

describe("dApp chain-change notifications", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  const register = (origin: string) => {
    const stream = { write: vi.fn() };
    cleanups.push(registerDAppAccountNotificationStream({ origin }, stream));
    return stream;
  };

  const chainStorage = (activeChainId: unknown) => ({
    ACTIVE_BLOCKCHAIN: activeChainId,
    ALL_BLOCKCHAINS: [],
  });

  it("tells every connected page that the active chain moved", () => {
    const alpha = register("https://alpha.example/path");
    const beta = register("https://beta.example/path");

    notifyDAppChainChanged({
      oldValue: chainStorage("0x539"),
      newValue: chainStorage("0x301825"),
    });

    const notification = {
      jsonrpc: "2.0",
      method: "qrlWallet_chainChanged",
      params: { chainId: "0x301825", networkVersion: "3151909" },
    };
    expect(alpha.write).toHaveBeenCalledWith(notification);
    expect(beta.write).toHaveBeenCalledWith(notification);
  });

  it("says nothing when the active chain is unchanged", () => {
    const stream = register("https://dapp.example");

    notifyDAppChainChanged({
      oldValue: chainStorage("0x301825"),
      newValue: chainStorage("0X301825"),
    });

    expect(stream.write).not.toHaveBeenCalled();
  });

  it("says nothing for a write that carries no active chain", () => {
    const stream = register("https://dapp.example");

    notifyDAppChainChanged({
      oldValue: chainStorage("0x539"),
      newValue: { ALL_BLOCKCHAINS: [] },
    });
    notifyDAppChainChanged(undefined);

    expect(stream.write).not.toHaveBeenCalled();
  });

  it("says nothing for a stored chain id that is not a number", () => {
    const stream = register("https://dapp.example");

    notifyDAppChainChanged({
      oldValue: chainStorage("0x539"),
      newValue: chainStorage("not-a-chain-id"),
    });

    expect(stream.write).not.toHaveBeenCalled();
  });
});
