import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import { getStoredValue } from "@/utilities/storageGuards";
import { ACCOUNT, OTHER_ACCOUNT } from "@/utilities/__mocks__/storageFixtures";
import { DEFAULT_BLOCKCHAIN } from "@/configuration/qrlBlockchainConfig";
import TokenTransfer from "./TokenTransfer";

const h = vi.hoisted(() => {
  const values: Record<string, unknown> = {};
  const copy = (value: unknown): unknown =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const local = {
    get: (key: string) => Promise.resolve({ [key]: copy(values[key]) }),
    set: (data: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(data))
        values[key] = copy(value);
      return Promise.resolve();
    },
    remove: (key: string) => {
      Reflect.deleteProperty(values, key);
      return Promise.resolve();
    },
  };
  return { values, local };
});
vi.mock("@/utilities/profileStorage", () => ({
  walletLocalStorage: h.local,
  walletSessionStorage: h.local,
  profileStorageKey: (key: string) => key,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const key of Object.keys(h.values))
    Reflect.deleteProperty(h.values, key);
});

it.each([false, null, 0, { future: true }])(
  "cold-opens a saved token draft with image %j through real storage",
  async (tokenImage) => {
    const key = `${DEFAULT_BLOCKCHAIN.chainId}_TRANSACTION_VALUES`;
    const draft = {
      receiverAddress: OTHER_ACCOUNT,
      amount: "1.5",
      tokenDetails: {
        isZrc20Token: true,
        tokenContractAddress: ACCOUNT,
        tokenDecimals: 18,
        tokenImage,
        tokenBalance: "10",
        tokenBalanceBaseUnits: "10000000000000000000",
        tokenName: "Token",
        tokenSymbol: "TOK",
      },
    };
    await StorageUtil.setTransactionValues(draft);
    expect(await StorageUtil.getTransactionValues()).toEqual(draft);
    await act(() => {
      render(
        <StoreProvider
          value={mockedStore({
            qrlStore: { activeAccount: { accountAddress: ACCOUNT } },
          })}
        >
          <MemoryRouter>
            <TokenTransfer />
          </MemoryRouter>
        </StoreProvider>,
      );
      return Promise.resolve();
    });
    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: "receiverAddress" }),
      ).toHaveValue(OTHER_ACCOUNT);
      expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
        "1.5",
      );
      expect(
        screen.getByRole("button", { name: "Send TOK" }),
      ).toBeInTheDocument();
      expect(getStoredValue(h.values[key], "receiverAddress")).toBe(
        OTHER_ACCOUNT,
      );
      expect(getStoredValue(h.values[key], "amount")).toBe("1.5");
    });
  },
);
