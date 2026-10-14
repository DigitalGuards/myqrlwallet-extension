import { afterEach, describe, expect, it, vi } from "vitest";
import QrlStore from "./qrlStore";
import { deferred } from "@/test-utils/deferred";
import StorageUtil from "@/utilities/storageUtil";

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
