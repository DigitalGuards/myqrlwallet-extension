import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, getURL, getSettings } = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue("id"),
  getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
  getSettings: vi.fn(),
}));

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    notifications: { create },
    runtime: { getURL },
  },
}));

vi.mock("@/utilities/storageUtil", () => ({
  __esModule: true,
  default: { getSettings },
}));

import { showTransactionNotification } from "./transactionNotification";

describe("showTransactionNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettings.mockResolvedValue({});
  });

  it("raises a confirmation notification naming the amount and token", async () => {
    await showTransactionNotification({
      status: "confirmed",
      amount: "1.5",
      tokenSymbol: "Quanta",
      txHash: "0xabc",
    });

    expect(create).toHaveBeenCalledWith(
      "tx-0xabc",
      expect.objectContaining({
        title: "Transaction Confirmed",
        message: "Your transaction of 1.5 Quanta was confirmed.",
      }),
    );
  });

  it("raises a failure notification for a reverted transaction", async () => {
    await showTransactionNotification({ status: "failed", txHash: "0xabc" });

    expect(create).toHaveBeenCalledWith(
      "tx-0xabc",
      expect.objectContaining({ title: "Transaction Failed" }),
    );
  });

  it("stays silent when notifications are switched off", async () => {
    getSettings.mockResolvedValue({ notificationsEnabled: false });

    await showTransactionNotification({
      status: "confirmed",
      txHash: "0xabc",
    });

    expect(create).not.toHaveBeenCalled();
  });

  it("notifies on a wallet that predates the setting", async () => {
    getSettings.mockResolvedValue({ notificationsEnabled: undefined });

    await showTransactionNotification({
      status: "confirmed",
      txHash: "0xabc",
    });

    expect(create).toHaveBeenCalled();
  });

  it("swallows a notifications API failure", async () => {
    create.mockRejectedValueOnce(new Error("permission denied"));

    await expect(
      showTransactionNotification({ status: "confirmed", txHash: "0xabc" }),
    ).resolves.toBeUndefined();
  });
});
