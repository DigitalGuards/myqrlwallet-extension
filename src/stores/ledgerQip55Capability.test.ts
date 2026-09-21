import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAccounts,
  getAddress,
  getPublicKey,
  signTransaction,
  verifyAddress,
} = vi.hoisted(() => ({
  getAccounts: vi.fn(),
  getAddress: vi.fn(),
  getPublicKey: vi.fn(),
  signTransaction: vi.fn(),
  verifyAddress: vi.fn(),
}));

vi.mock("@/services/ledger/ledgerTransport", () => ({
  ledgerTransport: {
    disconnect: vi.fn(),
    onDisconnect: vi.fn(),
  },
}));

vi.mock("@/services/ledger/ledgerService", () => ({
  ledgerService: {
    connect: vi.fn(),
    getAccounts,
    getAddress,
    getPublicKey,
    signTransaction,
    verifyAddress,
  },
}));

vi.mock("@/utilities/storageUtil", () => ({
  default: {
    addLedgerAccountToAllAccounts: vi.fn(),
    getLedgerAccounts: vi.fn().mockResolvedValue([]),
    removeLedgerAccountFromAllAccounts: vi.fn(),
    setLedgerAccounts: vi.fn(),
  },
}));

import { LEDGER_ERROR_MESSAGES } from "@/constants/ledger";
import LedgerStore from "./ledgerStore";

const ADDRESS = `Q${"0".repeat(128)}`;

describe("Ledger QIP-55 capability boundary", () => {
  let store: LedgerStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new LedgerStore();
    store.connectionState = "connected";
  });

  it("blocks device address and public-key operations", async () => {
    const unsupported = LEDGER_ERROR_MESSAGES.QIP55_UNSUPPORTED;

    await expect(store.loadAccounts()).rejects.toThrow(unsupported);
    await expect(store.fetchPageAccounts()).rejects.toThrow(unsupported);
    await expect(store.addAccount()).rejects.toThrow(unsupported);
    await expect(store.verifyAddress(ADDRESS)).rejects.toThrow(unsupported);
    await expect(store.fetchPublicKey(ADDRESS)).rejects.toThrow(unsupported);

    expect(getAccounts).not.toHaveBeenCalled();
    expect(getAddress).not.toHaveBeenCalled();
    expect(getPublicKey).not.toHaveBeenCalled();
    expect(verifyAddress).not.toHaveBeenCalled();
  });

  it("returns a local error before attempting device signing", async () => {
    const result = await store.signTransaction(ADDRESS, "0x02");

    expect(result).toEqual({
      success: false,
      error: LEDGER_ERROR_MESSAGES.QIP55_UNSUPPORTED,
    });
    expect(store.signingState).toBe("error");
    expect(store.signingStatus).toEqual({
      state: "error",
      message: LEDGER_ERROR_MESSAGES.QIP55_UNSUPPORTED,
    });
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("blocks transaction serialization before constructing a device payload", async () => {
    await expect(
      store.signAndSerializeTransaction(ADDRESS, {}, {}),
    ).rejects.toThrow(LEDGER_ERROR_MESSAGES.QIP55_UNSUPPORTED);

    expect(signTransaction).not.toHaveBeenCalled();
  });
});
