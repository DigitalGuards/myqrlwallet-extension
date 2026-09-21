import { afterEach, describe, expect, it, vi } from "vitest";
import QrlStore from "./qrlStore";
import StorageUtil from "@/utilities/storageUtil";

afterEach(() => vi.restoreAllMocks());

it("a stale startup cannot clear an account during unlock initialization", async () => {
  const initialize = QrlStore.prototype.initializeBlockchain;
  vi.spyOn(QrlStore.prototype, "initializeBlockchain").mockResolvedValue();
  vi.spyOn(QrlStore.prototype, "refreshBlockchainData").mockResolvedValue();
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const network = vi
    .spyOn(QrlStore.prototype, "fetchQrlConnection")
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSecond = resolve;
        }),
    );
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

  const first = initialize.call(store);
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1));
  const second = initialize.call(store);
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(2));
  releaseFirst();
  await first;
  expect(fetchAccounts).not.toHaveBeenCalled();
  expect(validate).not.toHaveBeenCalled();
  releaseSecond();
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
    let release!: (address: string) => void;
    vi.spyOn(StorageUtil, "getActiveAccount").mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const hydration = store.validateActiveAccount();
    expect(store.activeAccount.accountAddress).toBe(address);
    release(address);
    await hydration;
    expect(store.activeAccount.accountAddress).toBe(address);
  });
});
