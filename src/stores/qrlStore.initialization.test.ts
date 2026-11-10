import { afterEach, describe, expect, it, vi } from "vitest";
import QrlStore from "./qrlStore";
import { deferred } from "@/test-utils/deferred";
import StorageUtil from "@/utilities/storageUtil";
import { DEFAULT_BLOCKCHAIN } from "@/configuration/qrlBlockchainConfig";

afterEach(() => vi.restoreAllMocks());

it("a stale startup cannot clear an account during unlock initialization", async () => {
  const initializeSpy = vi.spyOn(QrlStore.prototype, "initializeBlockchain");
  initializeSpy.mockResolvedValue();
  vi.spyOn(QrlStore.prototype, "refreshBlockchainData").mockResolvedValue();
  const firstNetwork = deferred<undefined>();
  const secondNetwork = deferred<undefined>();
  const network = vi
    .spyOn(QrlStore.prototype, "fetchQrlConnection")
    .mockReturnValueOnce(firstNetwork.promise)
    .mockReturnValueOnce(secondNetwork.promise);
  const fetchAccounts = vi
    .spyOn(QrlStore.prototype, "fetchAccounts")
    .mockResolvedValue();
  const validate = vi
    .spyOn(QrlStore.prototype, "validateActiveAccount")
    .mockResolvedValue();
  vi.spyOn(QrlStore.prototype, "startBalancePolling").mockImplementation(
    () => undefined,
  );
  const store = new QrlStore();
  initializeSpy.mockRestore();

  const first = QrlStore.prototype.initializeBlockchain.call(store);
  await vi.waitFor(() => {
    expect(network).toHaveBeenCalledTimes(1);
  });
  const second = QrlStore.prototype.initializeBlockchain.call(store);
  await vi.waitFor(() => {
    expect(network).toHaveBeenCalledTimes(2);
  });
  firstNetwork.resolve(undefined);
  await first;
  expect(fetchAccounts).not.toHaveBeenCalled();
  expect(validate).not.toHaveBeenCalled();
  secondNetwork.resolve(undefined);
  await second;
  expect(fetchAccounts).toHaveBeenCalledTimes(1);
  expect(validate).toHaveBeenCalledTimes(1);
});

describe("active account hydration", () => {
  it("retains the current account while reading persistence", async () => {
    vi.spyOn(QrlStore.prototype, "initializeBlockchain").mockResolvedValue();
    const store = new QrlStore();
    const address = `Q${"a".repeat(128)}`;
    store.activeAccount = { accountAddress: address };
    store.qrlAccounts = {
      accounts: [{ accountAddress: address, accountBalance: "0" }],
      isLoading: false,
    };
    const { promise, resolve: release } = deferred<string>();
    vi.spyOn(StorageUtil, "getActiveAccount").mockReturnValue(promise);
    const hydration = store.validateActiveAccount();
    expect(store.activeAccount.accountAddress).toBe(address);
    release(address);
    await hydration;
    expect(store.activeAccount.accountAddress).toBe(address);
  });
});

describe("an RPC URL the provider refuses", () => {
  it("drops the previous provider and still clears the startup loader", async () => {
    const account = `Q${"a".repeat(128)}`;
    const customChain = {
      ...DEFAULT_BLOCKCHAIN,
      chainId: "0x5",
      isCustomChain: true,
    };
    vi.spyOn(StorageUtil, "getActiveBlockChain")
      .mockResolvedValueOnce({
        ...customChain,
        defaultRpcUrl: "https://rpc.example",
      })
      .mockResolvedValueOnce({
        ...customChain,
        defaultRpcUrl: "https://user:secret@rpc.example",
      });
    vi.spyOn(StorageUtil, "getAllAccounts")
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([account]);
    vi.spyOn(StorageUtil, "getActiveAccount").mockResolvedValue(account);
    vi.spyOn(StorageUtil, "clearActiveAccount").mockResolvedValue();
    vi.spyOn(QrlStore.prototype, "startBalancePolling").mockImplementation(
      () => undefined,
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const initializeSpy = vi.spyOn(QrlStore.prototype, "initializeBlockchain");
    initializeSpy.mockResolvedValue();
    const store = new QrlStore();
    initializeSpy.mockRestore();

    await QrlStore.prototype.initializeBlockchain.call(store);
    expect(store.qrlInstance).toBeDefined();

    // @theqrl/web3 2.0.0 refuses to build a provider for this URL.
    await expect(
      QrlStore.prototype.initializeBlockchain.call(store),
    ).resolves.toBeUndefined();
    expect(store.qrlConnection.blockchain.defaultRpcUrl).toBe(
      "https://user:secret@rpc.example",
    );
    expect(store.qrlInstance).toBeUndefined();
    expect(store.initProgress.active).toBe(false);
    expect(store.qrlConnection.isConnected).toBe(false);
    expect(store.qrlConnection.isLoading).toBe(false);
    expect(store.qrlAccounts.accounts.map((a) => a.accountAddress)).toEqual([
      account,
    ]);
    expect(store.activeAccount.accountAddress).toBe(account);
    expect(logged).toHaveBeenCalledWith(
      "[initializeBlockchain] Cannot use the RPC URL:",
      expect.anything(),
    );
    expect(String(logged.mock.calls[0]?.[1])).not.toContain("secret");
  });
});
