import { afterEach, describe, expect, it, vi } from "vitest";
import {
  notifyDAppAccountsChanged,
  registerDAppAccountNotificationStream,
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
  ])("rejects opaque or malformed sender identity %#", (sender) => {
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
});
