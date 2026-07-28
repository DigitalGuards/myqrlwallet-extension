import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetBalance, mockIsListening } = vi.hoisted(() => ({
  mockGetBalance: vi.fn<any>().mockResolvedValue(BigInt(0)),
  mockIsListening: vi.fn<any>().mockResolvedValue(true),
}));

vi.mock("@theqrl/web3", () => {
  class MockWeb3 {
    static providers = { HttpProvider: class {} };
    qrl = { getBalance: mockGetBalance, net: { isListening: mockIsListening } };
    constructor(_opts: unknown) {}
  }
  return {
    __esModule: true,
    default: MockWeb3,
    utils: { fromPlanck: (v: bigint) => (Number(v) / 1e18).toString() },
  };
});

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getAllAccounts: vi.fn<any>().mockResolvedValue([]),
    setAllAccounts: vi.fn<any>().mockResolvedValue(undefined),
    getKeystores: vi.fn<any>().mockResolvedValue([]),
    setKeystores: vi.fn<any>().mockResolvedValue(undefined),
    getAllBlockChains: vi.fn<any>().mockResolvedValue([]),
    getActiveBlockChain: vi.fn<any>().mockResolvedValue(""),
    setActiveBlockChain: vi.fn<any>().mockResolvedValue(undefined),
    getActiveAccount: vi.fn<any>().mockResolvedValue(""),
    setActiveAccount: vi.fn<any>().mockResolvedValue(undefined),
    clearActiveAccount: vi.fn<any>().mockResolvedValue(undefined),
    clearAllAccountData: vi.fn<any>().mockResolvedValue(undefined),
    removeAccountFromAllDApps: vi.fn<any>().mockResolvedValue(undefined),
  },
}));

vi.mock("@/utilities/storageUtil", () => ({
  __esModule: true,
  default: mockStorage,
}));

import QrlStore from "./qrlStore";

const SOFTWARE = "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1";
const SECOND = "Q20fB08fF1f1376A14C055E9F56df80563E16722b";
// Keystores store the address lowercased behind the Q prefix; the UI passes
// the checksummed form, so every comparison has to be case-insensitive.
const keystoreFor = (address: string) => ({
  address: `Q${address.slice(1).toLowerCase()}`,
});

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("QrlStore.removeAccount", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockStorage.getAllBlockChains.mockResolvedValue([]);
    mockStorage.getActiveBlockChain.mockResolvedValue("");
  });

  const createStore = async () => {
    const store = new QrlStore();
    await flush();
    vi.clearAllMocks();
    return store;
  };

  it("removes the keystore, the accounts entry, dApp grants and per-account data", async () => {
    mockStorage.getKeystores.mockResolvedValue([
      keystoreFor(SOFTWARE),
      keystoreFor(SECOND),
    ]);
    mockStorage.getAllAccounts.mockResolvedValue([SOFTWARE, SECOND]);
    mockStorage.getActiveAccount.mockResolvedValue(SOFTWARE);

    const store = await createStore();
    await store.removeAccount(SECOND);

    expect(mockStorage.setAllAccounts).toHaveBeenCalledWith([SOFTWARE]);
    expect(mockStorage.setKeystores).toHaveBeenCalledWith([
      keystoreFor(SOFTWARE),
    ]);
    expect(mockStorage.removeAccountFromAllDApps).toHaveBeenCalledWith(SECOND);
    expect(mockStorage.clearAllAccountData).toHaveBeenCalledWith(SECOND);
  });

  it("deletes the keystore last, after the recoverable steps", async () => {
    // An interrupted removal (Chrome destroys the popup the moment it loses
    // focus) must not leave a listed account whose seed is already gone.
    mockStorage.getKeystores.mockResolvedValue([
      keystoreFor(SOFTWARE),
      keystoreFor(SECOND),
    ]);
    mockStorage.getAllAccounts.mockResolvedValue([SOFTWARE, SECOND]);
    mockStorage.getActiveAccount.mockResolvedValue(SOFTWARE);

    const order: string[] = [];
    mockStorage.setAllAccounts.mockImplementation(async () => {
      order.push("accounts");
    });
    mockStorage.setKeystores.mockImplementation(async () => {
      order.push("keystores");
    });

    const store = await createStore();
    await store.removeAccount(SECOND);

    expect(order).toEqual(["accounts", "keystores"]);
  });

  it("refuses to remove the last keystore while other accounts remain", async () => {
    // Ledger accounts sit in the accounts list without a keystore. Emptying
    // KEYSTORES with accounts still listed makes the service worker report
    // a first-run wallet: onboarding, with no password gate, while usable
    // accounts remain.
    const LEDGER = "Q30fB08fF1f1376A14C055E9F56df80563E16722b";
    mockStorage.getKeystores.mockResolvedValue([keystoreFor(SOFTWARE)]);
    mockStorage.getAllAccounts.mockResolvedValue([SOFTWARE, LEDGER]);
    mockStorage.getActiveAccount.mockResolvedValue(LEDGER);

    const store = await createStore();

    await expect(store.removeAccount(SOFTWARE)).rejects.toThrow(
      "REMOVE_LAST_KEYSTORE_BLOCKED",
    );
    expect(mockStorage.setKeystores).not.toHaveBeenCalled();
    expect(mockStorage.setAllAccounts).not.toHaveBeenCalled();
  });

  it("allows removing a Ledger account, which has no keystore", async () => {
    const LEDGER = "Q30fB08fF1f1376A14C055E9F56df80563E16722b";
    mockStorage.getKeystores.mockResolvedValue([keystoreFor(SOFTWARE)]);
    mockStorage.getAllAccounts.mockResolvedValue([SOFTWARE, LEDGER]);
    mockStorage.getActiveAccount.mockResolvedValue(SOFTWARE);

    const store = await createStore();
    await store.removeAccount(LEDGER);

    expect(mockStorage.setAllAccounts).toHaveBeenCalledWith([SOFTWARE]);
    expect(mockStorage.setKeystores).toHaveBeenCalledWith([
      keystoreFor(SOFTWARE),
    ]);
  });

  it("re-points the active account when the removed one was active", async () => {
    mockStorage.getKeystores.mockResolvedValue([
      keystoreFor(SOFTWARE),
      keystoreFor(SECOND),
    ]);
    mockStorage.getAllAccounts.mockResolvedValue([SOFTWARE, SECOND]);
    mockStorage.getActiveAccount.mockResolvedValue(SECOND);

    const store = await createStore();
    await store.removeAccount(SECOND);

    expect(mockStorage.setActiveAccount).toHaveBeenCalledWith(SOFTWARE);
  });

  it("matches the keystore regardless of address casing", async () => {
    mockStorage.getKeystores.mockResolvedValue([
      keystoreFor(SOFTWARE),
      keystoreFor(SECOND),
    ]);
    mockStorage.getAllAccounts.mockResolvedValue([SOFTWARE, SECOND]);
    mockStorage.getActiveAccount.mockResolvedValue(SOFTWARE);

    const store = await createStore();
    await store.removeAccount(SECOND.toLowerCase());

    expect(mockStorage.setKeystores).toHaveBeenCalledWith([
      keystoreFor(SOFTWARE),
    ]);
  });
});
