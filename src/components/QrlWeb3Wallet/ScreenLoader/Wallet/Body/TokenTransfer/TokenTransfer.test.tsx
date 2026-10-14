import { mockedStore } from "@/__mocks__/mockedStore";
import { ObservableBalances } from "@/__mocks__/observableBalances";
import { deferred } from "@/test-utils/deferred";
import type StorageUtil from "@/utilities/storageUtil";
import type { TransactionValuesType } from "@/utilities/storageUtil";
import { NATIVE_TOKEN } from "@/constants/nativeToken";
import { DEFAULT_BLOCKCHAIN } from "@/configuration/qrlBlockchainConfig";
import { walletLocalStorage } from "@/utilities/profileStorage";
import type { resolveQrnsName } from "@/utilities/qrnsResolver";
import Web3 from "@theqrl/web3";
import { observable, runInAction } from "mobx";
import { StoreProvider } from "@/stores/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { toChecksumAddress } from "@theqrl/wallet.js";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import TokenTransfer from "./TokenTransfer";

type QrlStore = ReturnType<typeof mockedStore>["qrlStore"];

vi.mock("@theqrl/web3", async () => {
  const originalModule =
    await vi.importActual<typeof import("@theqrl/web3")>("@theqrl/web3");
  return {
    ...originalModule,
    validator: { isAddressString: vi.fn(() => true) },
  };
});

const {
  mockGetTransactionValues,
  mockSetTransactionValues,
  mockClearTransactionValues,
  mockGetActiveBlockChain,
  mockResolveQrnsName,
} = vi.hoisted(() => ({
  mockGetTransactionValues: vi
    .fn<typeof StorageUtil.getTransactionValues>()
    .mockResolvedValue({
      receiverAddress: "",
      amount: 0,
    }),
  mockSetTransactionValues: vi
    .fn<typeof StorageUtil.setTransactionValues>()
    .mockResolvedValue(undefined),
  mockClearTransactionValues: vi
    .fn<typeof StorageUtil.clearTransactionValues>()
    .mockResolvedValue(undefined),
  mockGetActiveBlockChain: vi.fn<typeof StorageUtil.getActiveBlockChain>(),
  mockResolveQrnsName: vi.fn<typeof resolveQrnsName>(),
}));

vi.mock("@/utilities/qrnsResolver", async () => {
  const originalModule = await vi.importActual<
    typeof import("@/utilities/qrnsResolver")
  >("@/utilities/qrnsResolver");
  return {
    ...originalModule,
    resolveQrnsName: mockResolveQrnsName,
  };
});

vi.mock("@/utilities/storageUtil", () => {
  return {
    __esModule: true,
    default: {
      getTransactionValues: mockGetTransactionValues,
      setTransactionValues: mockSetTransactionValues,
      clearTransactionValues: mockClearTransactionValues,
      getActiveBlockChain: mockGetActiveBlockChain,
    },
  };
});

const successSignResult = {
  transactionHash: "0xtxhash",
  rawTransaction: "0xraw",
  error: "",
  nonce: 0,
  maxFeePerGas: "1000",
  maxPriorityFeePerGas: "100",
  gasLimit: 21000,
};

const ACCOUNT_A = toChecksumAddress(`Q${"a".repeat(128)}`);
const ACCOUNT_B = toChecksumAddress(`Q${"b".repeat(128)}`);
const CONTRACT_C = toChecksumAddress(`Q${"c".repeat(128)}`);
const CONTRACT_D = toChecksumAddress(`Q${"d".repeat(128)}`);
const QRNS_REGISTRY = toChecksumAddress(`Q${"e".repeat(128)}`);
const QRNS_RPC_URL = "https://qns-rpc.example";
const TOKEN_DETAILS = {
  isZrc20Token: true,
  tokenContractAddress: CONTRACT_C,
  tokenDecimals: 8,
  tokenImage: "token.png",
  tokenBalance: "3",
  tokenBalanceBaseUnits: "300000000",
  tokenName: "Token",
  tokenSymbol: "TOK",
};

const CurrentRoute = () => (
  <output aria-label="Current route">{useLocation().pathname}</output>
);

describe("TokenTransfer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mockGetTransactionValues.mockReset().mockResolvedValue({
      receiverAddress: "",
      amount: 0,
    });
    mockSetTransactionValues.mockReset().mockResolvedValue(undefined);
    mockClearTransactionValues.mockReset().mockResolvedValue(undefined);
    mockGetActiveBlockChain.mockReset().mockResolvedValue(DEFAULT_BLOCKCHAIN);
    mockResolveQrnsName.mockReset();
  });

  const withQip55Account = (store: ReturnType<typeof mockedStore>) => {
    store.qrlStore.activeAccount.accountAddress = ACCOUNT_A;
    return store;
  };

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={withQip55Account(mockedStoreValues)}>
        <MemoryRouter>
          <TokenTransfer />
          <CurrentRoute />
        </MemoryRouter>
      </StoreProvider>,
    );

  const renderComponentWithState = (
    state: unknown,
    mockedStoreValues = mockedStore(),
  ) =>
    render(
      <StoreProvider value={withQip55Account(mockedStoreValues)}>
        <MemoryRouter initialEntries={[{ pathname: "/token-transfer", state }]}>
          <TokenTransfer />
          <CurrentRoute />
        </MemoryRouter>
      </StoreProvider>,
    );

  const waitForEditing = async () => {
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "amount" })).toBeEnabled();
    });
  };

  // Async invocation drift changes which network a storage operation selects.
  // Deferring derived values can also discard the result of an earlier event.
  // Compare both classes with origin/dev while each dependency is pending.
  describe("origin/dev async timing", () => {
    const nativeDetails = {
      isZrc20Token: false,
      tokenContractAddress: "",
      tokenDecimals: 0,
      tokenImage: NATIVE_TOKEN.image,
      tokenBalance: "",
      tokenBalanceBaseUnits: "",
      tokenName: NATIVE_TOKEN.name,
      tokenSymbol: NATIVE_TOKEN.symbol,
    };
    const draftShapes = [
      { name: "native", tokenDetails: undefined },
      { name: "native metadata", tokenDetails: nativeDetails },
      { name: "ZRC-20", tokenDetails: TOKEN_DETAILS },
      {
        name: "legacy ZRC-20",
        tokenDetails: { ...TOKEN_DETAILS, tokenBalanceBaseUnits: undefined },
      },
    ];

    const realDraftStorage = async (saved: TransactionValuesType) => {
      const { default: storage } = await vi.importActual<
        typeof import("@/utilities/storageUtil")
      >("@/utilities/storageUtil");
      let chainId = DEFAULT_BLOCKCHAIN.chainId;
      const key = `${chainId}_TRANSACTION_VALUES`;
      vi.spyOn(storage, "getActiveBlockChain").mockImplementation(() =>
        Promise.resolve({ ...DEFAULT_BLOCKCHAIN, chainId }),
      );
      mockGetActiveBlockChain.mockImplementation(() =>
        storage.getActiveBlockChain(),
      );
      const values = new Map<string, unknown>([
        [key, saved],
        ["unrelated", { label: "unrelated record" }],
      ]);
      vi.spyOn(walletLocalStorage, "get").mockImplementation((key) =>
        Promise.resolve({ [key]: structuredClone(values.get(key)) }),
      );
      const commit = (data: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(data))
          values.set(key, structuredClone(value));
        return Promise.resolve();
      };
      const write = vi
        .spyOn(walletLocalStorage, "set")
        .mockImplementation(commit);
      const remove = vi
        .spyOn(walletLocalStorage, "remove")
        .mockImplementation((key) => {
          values.delete(key);
          return Promise.resolve();
        });
      mockGetTransactionValues.mockImplementation((...args) =>
        storage.getTransactionValues(...args),
      );
      mockSetTransactionValues.mockImplementation((...args) =>
        storage.setTransactionValues(...args),
      );
      mockClearTransactionValues.mockImplementation((...args) =>
        storage.clearTransactionValues(...args),
      );
      return {
        storage,
        values,
        write,
        remove,
        commit,
        key,
        selectChain: (selected: string) => {
          chainId = selected;
        },
      };
    };

    it.each(
      draftShapes.flatMap((draft) =>
        ["close", "cancel", "pending cancel"].flatMap((action) =>
          ["amount", "receiverAddress"].map((field) => ({
            ...draft,
            action,
            field,
          })),
        ),
      ),
    )(
      "starts both $field saves before $action for $name and preserves the other network's draft",
      async ({ action, field, tokenDetails }) => {
        const initial = {
          amount: field === "amount" ? "" : "1",
          receiverAddress: ACCOUNT_B,
          tokenDetails,
        };
        const first = {
          amount: "1",
          receiverAddress: field === "amount" ? ACCOUNT_B : CONTRACT_C,
        };
        const second = {
          amount: field === "amount" ? "2" : "1",
          receiverAddress: field === "amount" ? ACCOUNT_B : CONTRACT_D,
        };
        const { values, write, remove, commit, key, selectChain } =
          await realDraftStorage(initial);
        const otherKey = "0x2_TRANSACTION_VALUES";
        const otherDraft = {
          amount: "7",
          receiverAddress: CONTRACT_D,
          tokenDetails: TOKEN_DETAILS,
          futureMetadata: { label: "other network" },
        };
        values.set(otherKey, otherDraft);
        const view = renderComponent(
          mockedStore({
            qrlStore: { getAccountBalance: () => "100.0 Quanta" },
          }),
        );
        await waitFor(() => {
          expect(
            screen.getByRole("textbox", { name: "receiverAddress" }),
          ).toHaveValue(ACCOUNT_B);
          expect(values.get(key)).toMatchObject({ receiverAddress: ACCOUNT_B });
        });
        const saving = deferred<undefined>();
        const clearing = deferred<undefined>();
        write.mockClear().mockImplementationOnce((data) => {
          const snapshot = structuredClone(data);
          return saving.promise.then(() => commit(snapshot));
        });
        if (action === "pending cancel") {
          remove.mockImplementationOnce((key) =>
            clearing.promise.then(() => {
              values.delete(key);
            }),
          );
        }
        const input = screen.getByRole("textbox", { name: field });
        fireEvent.change(input, {
          target: {
            value: field === "amount" ? first.amount : first.receiverAddress,
          },
        });
        await waitFor(() => {
          expect(write.mock.calls[0]?.[0][key]).toMatchObject(first);
        });
        await act(async () => {
          fireEvent.change(input, {
            target: {
              value:
                field === "amount" ? second.amount : second.receiverAddress,
            },
          });
          await Promise.resolve();
        });
        // The second save captures its network while the first is pending.
        expect(write.mock.calls.map(([data]) => data[key])).toContainEqual(
          expect.objectContaining(second),
        );
        if (action !== "close") {
          await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
          expect(remove).toHaveBeenCalledExactlyOnceWith(key);
          expect(
            screen.getByRole("status", { name: "Current route" }),
          ).toHaveTextContent(/^\/$/);
        }
        view.unmount();
        selectChain("0x2");
        await act(async () => {
          saving.resolve(undefined);
          await saving.promise;
          clearing.resolve(undefined);
          await clearing.promise;
        });
        expect(values.get(otherKey)).toEqual(otherDraft);
        expect(values.get("unrelated")).toEqual({ label: "unrelated record" });
      },
    );

    it.each(
      draftShapes.flatMap((draft) =>
        ["first save", "second save"].map((completesFirst) => ({
          ...draft,
          completesFirst,
        })),
      ),
    )(
      "keeps both $name saves on their original network when $completesFirst completes first after closing",
      async ({ tokenDetails, completesFirst }) => {
        const { values, write, commit, key, selectChain } =
          await realDraftStorage({
            amount: "1",
            receiverAddress: ACCOUNT_B,
            tokenDetails,
          });
        const otherKey = "0x2_TRANSACTION_VALUES";
        const otherDraft = {
          amount: "7",
          receiverAddress: CONTRACT_D,
          tokenDetails: TOKEN_DETAILS,
          futureMetadata: { label: "other network" },
        };
        values.set(otherKey, otherDraft);
        const view = renderComponent(
          mockedStore({
            qrlStore: { getAccountBalance: () => "100.0 Quanta" },
          }),
        );
        const amount = screen.getByRole("textbox", { name: "amount" });
        await waitFor(() => {
          expect(amount).toHaveValue("1");
          expect(values.get(key)).toMatchObject({
            amount: "1",
            receiverAddress: ACCOUNT_B,
          });
        });
        const first = deferred<undefined>();
        const second = deferred<undefined>();
        let saving = first;
        write.mockClear().mockImplementation((data) => {
          const snapshot = structuredClone(data);
          return saving.promise.then(() => commit(snapshot));
        });
        await act(async () => {
          fireEvent.change(amount, { target: { value: "2" } });
          await Promise.resolve();
        });
        const firstWrites = structuredClone(write.mock.calls);
        expect(firstWrites.length).toBeGreaterThan(0);
        for (const [data] of firstWrites) {
          expect(Object.keys(data)).toEqual([key]);
          expect(data[key]).toMatchObject({
            amount: "2",
            receiverAddress: ACCOUNT_B,
          });
        }
        saving = second;
        await act(async () => {
          fireEvent.change(
            screen.getByRole("textbox", { name: "receiverAddress" }),
            { target: { value: CONTRACT_C } },
          );
          await Promise.resolve();
        });
        const writesBeforeClose = structuredClone(write.mock.calls);
        const secondWrites = writesBeforeClose.slice(firstWrites.length);
        expect(secondWrites.length).toBeGreaterThan(0);
        for (const [data] of secondWrites) {
          expect(Object.keys(data)).toEqual([key]);
          expect(data[key]).toMatchObject({
            amount: "2",
            receiverAddress: CONTRACT_C,
          });
        }
        view.unmount();
        selectChain("0x2");
        const completions =
          completesFirst === "first save" ? [first, second] : [second, first];
        for (const completed of completions) {
          await act(async () => {
            completed.resolve(undefined);
            await completed.promise;
          });
          expect(values.get(otherKey)).toEqual(otherDraft);
          expect(values.get("unrelated")).toEqual({
            label: "unrelated record",
          });
          expect(write.mock.calls).toEqual(writesBeforeClose);
        }
      },
    );

    it("reads the active network again at each save invocation", async () => {
      const { values, write, key, selectChain } = await realDraftStorage({
        amount: "1",
        receiverAddress: ACCOUNT_B,
      });
      renderComponent();
      await waitFor(() => {
        expect(values.get(key)).toMatchObject({ amount: "1" });
        expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
          "1",
        );
      });
      selectChain("0x2");
      await act(async () => {
        fireEvent.change(screen.getByRole("textbox", { name: "amount" }), {
          target: { value: "2" },
        });
        await Promise.resolve();
      });
      expect(write.mock.lastCall?.[0]["0x2_TRANSACTION_VALUES"]).toMatchObject({
        amount: "2",
        receiverAddress: ACCOUNT_B,
      });
      expect(values.get(key)).toMatchObject({ amount: "1" });
    });

    it.each(draftShapes)(
      "clears a submitted $name draft while its autosave is pending",
      async ({ tokenDetails }) => {
        const { values, write, remove, commit, key, selectChain } =
          await realDraftStorage({
            amount: "1",
            receiverAddress: ACCOUNT_B,
            tokenDetails,
          });
        const otherKey = "0x2_TRANSACTION_VALUES";
        const otherDraft = {
          amount: "7",
          receiverAddress: CONTRACT_D,
          tokenDetails: TOKEN_DETAILS,
          futureMetadata: { label: "other network" },
        };
        values.set(otherKey, otherDraft);
        const broadcast = deferred<undefined>();
        const view = renderComponent(
          mockedStore({
            qrlStore: {
              signNativeToken: () => Promise.resolve(successSignResult),
              signZrc20Token: () => Promise.resolve(successSignResult),
              sendRawTransaction: () => broadcast.promise,
              getAccountBalance: () => "100.0 Quanta",
            },
          }),
        );
        const amount = screen.getByRole("textbox", { name: "amount" });
        await waitFor(() => {
          expect(amount).toHaveValue("1");
          expect(values.get(key)).toMatchObject({ amount: "1" });
        });
        const saving = deferred<undefined>();
        write.mockImplementationOnce((data) => {
          const snapshot = structuredClone(data);
          return saving.promise.then(() => commit(snapshot));
        });
        fireEvent.change(amount, { target: { value: "2" } });
        const send = screen.getByRole("button", {
          name: tokenDetails?.isZrc20Token ? "Send TOK" : "Send Quanta",
        });
        await waitFor(() => {
          expect(send).toBeEnabled();
          expect(write.mock.lastCall?.[0][key]).toMatchObject({ amount: "2" });
        });
        await userEvent.click(send);
        expect(remove).toHaveBeenCalledExactlyOnceWith(key);
        expect(
          screen.getByRole("status", { name: "Current route" }),
        ).toHaveTextContent("/transaction-history");
        view.unmount();
        selectChain("0x2");
        await act(async () => {
          saving.resolve(undefined);
          broadcast.resolve(undefined);
          await Promise.all([saving.promise, broadcast.promise]);
        });
        expect(values.get(otherKey)).toEqual(otherDraft);
        expect(values.get("unrelated")).toEqual({ label: "unrelated record" });
      },
    );

    it.each([
      { name: "fresh transfer", state: { shouldStartFresh: true } },
      ...draftShapes
        .filter(({ tokenDetails }) => tokenDetails !== undefined)
        .map(({ name, tokenDetails }) => ({ name, state: { tokenDetails } })),
    ])(
      "starts the $name reset while form defaults are pending",
      async ({ state }) => {
        const defaults = deferred<TransactionValuesType>();
        const clearing = deferred<undefined>();
        mockGetTransactionValues.mockReturnValueOnce(defaults.promise);
        mockClearTransactionValues.mockReturnValue(clearing.promise);
        renderComponentWithState(state);
        await waitFor(() => {
          expect(mockClearTransactionValues).toHaveBeenCalledOnce();
        });
        expect(mockSetTransactionValues).not.toHaveBeenCalled();
        await act(async () => {
          defaults.resolve({ amount: "1", receiverAddress: ACCOUNT_B });
          await defaults.promise;
        });
        expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
          "1",
        );
        await act(async () => {
          clearing.resolve(undefined);
          await clearing.promise;
        });
        expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue("");
        expect(mockSetTransactionValues).toHaveBeenLastCalledWith(
          expect.objectContaining({ amount: "", receiverAddress: "" }),
        );
      },
    );

    it.each(["amount", "receiverAddress"])(
      "starts a %s save while the initialization save is pending",
      async (field) => {
        const saving = deferred<undefined>();
        mockSetTransactionValues.mockReturnValueOnce(saving.promise);
        renderComponent();
        await waitFor(() => {
          expect(mockSetTransactionValues).toHaveBeenCalled();
        });
        const input = screen.getByRole("textbox", { name: field });
        expect(input).toBeEnabled();
        await act(async () => {
          fireEvent.change(input, {
            target: { value: field === "amount" ? "1" : ACCOUNT_B },
          });
          await Promise.resolve();
        });
        expect(mockSetTransactionValues).toHaveBeenLastCalledWith({
          amount: field === "amount" ? "1" : "",
          receiverAddress: field === "amount" ? "" : ACCOUNT_B,
          tokenDetails: nativeDetails,
        });
        await act(async () => {
          saving.resolve(undefined);
          await saving.promise;
        });
        expect(input).toHaveValue(field === "amount" ? "1" : ACCOUNT_B);
      },
    );

    it.each(
      draftShapes.flatMap((draft) =>
        [
          {
            scenario: "balance grows",
            amount: "10",
            firstAmount: "9",
            balance: "20.0 Quanta",
            edit: undefined,
            finalAmount: "9",
            percentage: "50",
          },
          {
            scenario: "numeric amount and unchanged balance",
            amount: 10,
            firstAmount: "9",
            balance: "10.0 Quanta",
            edit: undefined,
            finalAmount: "8",
            percentage: "100",
          },
          {
            scenario: "balance falls",
            amount: "10",
            firstAmount: "9",
            balance: "8.0 Quanta",
            edit: undefined,
            finalAmount: "6",
            percentage: "100",
          },
          {
            scenario: "user edits the adjusted amount",
            amount: "10",
            firstAmount: "9",
            balance: "20.0 Quanta",
            edit: "4",
            finalAmount: "4",
            percentage: "22",
          },
          {
            scenario: "user clears the adjusted amount",
            amount: "10",
            firstAmount: "9",
            balance: "20.0 Quanta",
            edit: "",
            finalAmount: "",
            percentage: "0",
          },
          {
            scenario: "reserve exhausts the balance",
            amount: "10",
            firstAmount: "9",
            balance: "2.0 Quanta",
            edit: undefined,
            finalAmount: "",
            percentage: "0",
          },
          {
            scenario: "balance exhausts available funds before the fee update",
            amount: "10",
            firstAmount: "9",
            balance: "1.0 Quanta",
            edit: undefined,
            finalAmount: "9",
            percentage: "0",
          },
          {
            scenario: "amount below Max",
            amount: "5",
            firstAmount: "5",
            balance: "20.0 Quanta",
            edit: undefined,
            finalAmount: "5",
            percentage: "28",
          },
        ].map((scenario) => ({ ...draft, ...scenario })),
      ),
    )(
      "applies gas events before $name restoration when $scenario",
      async ({
        tokenDetails,
        amount: savedAmount,
        firstAmount,
        balance,
        edit,
        finalAmount,
        percentage,
      }) => {
        const saved = {
          amount: savedAmount,
          receiverAddress: ACCOUNT_B,
          tokenDetails,
        };
        const { values, key } = await realDraftStorage(saved);
        const details = deferred<TransactionValuesType>();
        mockGetTransactionValues
          .mockResolvedValueOnce(saved)
          .mockReturnValueOnce(details.promise);
        const gas = deferred<string>();
        const balances = new ObservableBalances({ [ACCOUNT_A]: "10.0 Quanta" });
        const settings = observable<{
          defaultGasTier: "market" | "aggressive";
        }>({
          defaultGasTier: "market",
        });
        const getGas = vi.fn<QrlStore["getNativeTokenGas"]>((overrides) =>
          overrides?.tier === "aggressive" ? Promise.resolve("2") : gas.promise,
        );
        const store = mockedStore({
          qrlStore: {
            getAccountBalance: balances.getAccountBalance,
            getNativeTokenGas: getGas,
          },
        });
        Object.defineProperty(store.settingsStore, "defaultGasTier", {
          get: () => settings.defaultGasTier,
        });
        renderComponent(store);
        const amount = screen.getByRole("textbox", { name: "amount" });
        await waitFor(() => {
          expect(amount).toHaveValue(String(savedAmount));
          expect(screen.getByRole("slider")).toHaveAttribute(
            "aria-valuenow",
            savedAmount === "5" ? "50" : "100",
          );
        });
        await act(async () => {
          gas.resolve("1");
          await gas.promise;
        });
        expect(amount).toHaveValue(firstAmount);
        expect(values.get(key)).toMatchObject({ amount: firstAmount });
        if (edit !== undefined) {
          await act(async () => {
            fireEvent.change(amount, { target: { value: edit } });
            await Promise.resolve();
          });
        }
        act(() => {
          balances.set(ACCOUNT_A, balance);
        });
        await act(async () => {
          runInAction(() => {
            settings.defaultGasTier = "aggressive";
          });
          await Promise.resolve();
        });
        expect(getGas).toHaveBeenCalledWith({ tier: "aggressive" });
        expect(amount).toHaveValue(finalAmount);
        expect(values.get(key)).toMatchObject({
          amount: finalAmount,
          receiverAddress: ACCOUNT_B,
        });
        expect(screen.getByRole("slider")).toHaveAttribute(
          "aria-valuenow",
          percentage,
        );
        await act(async () => {
          details.resolve(saved);
          await details.promise;
        });
        expect(amount).toHaveValue(finalAmount);
        expect(values.get(key)).toMatchObject({
          amount: finalAmount,
          receiverAddress: ACCOUNT_B,
        });
      },
    );

    it("starts metadata restoration while form defaults are pending", async () => {
      const defaults = deferred<TransactionValuesType>();
      mockGetTransactionValues
        .mockReturnValueOnce(defaults.promise)
        .mockResolvedValueOnce({ tokenDetails: TOKEN_DETAILS });
      renderComponent();
      expect(
        await screen.findByRole("button", { name: "Send TOK" }),
      ).toBeInTheDocument();
      expect(mockGetTransactionValues).toHaveBeenCalledTimes(2);
      expect(mockSetTransactionValues).toHaveBeenCalledWith({
        amount: undefined,
        receiverAddress: undefined,
        tokenDetails: TOKEN_DETAILS,
      });
      await act(async () => {
        defaults.resolve({ amount: "1", receiverAddress: ACCOUNT_B });
        await defaults.promise;
      });
      expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue("1");
      expect(mockSetTransactionValues).toHaveBeenLastCalledWith({
        amount: "1",
        receiverAddress: ACCOUNT_B,
        tokenDetails: TOKEN_DETAILS,
      });
    });

    it("saves edits immediately while metadata restoration is pending", async () => {
      const details = deferred<TransactionValuesType>();
      mockGetTransactionValues
        .mockResolvedValueOnce({ amount: "1", receiverAddress: ACCOUNT_B })
        .mockReturnValueOnce(details.promise);
      renderComponent();
      const amount = screen.getByRole("textbox", { name: "amount" });
      await waitFor(() => {
        expect(amount).toHaveValue("1");
      });
      expect(amount).toBeEnabled();
      await act(async () => {
        fireEvent.change(amount, { target: { value: "2" } });
        await Promise.resolve();
      });
      expect(mockSetTransactionValues).toHaveBeenLastCalledWith({
        amount: "2",
        receiverAddress: ACCOUNT_B,
        tokenDetails: nativeDetails,
      });
      await act(async () => {
        details.resolve({ tokenDetails: TOKEN_DETAILS });
        await details.promise;
      });
      expect(mockSetTransactionValues).toHaveBeenLastCalledWith({
        amount: "2",
        receiverAddress: ACCOUNT_B,
        tokenDetails: TOKEN_DETAILS,
      });
    });
  });

  it.each([null, Number.NaN, Infinity])(
    "opens a saved token transfer with decimals %s and keeps sending disabled",
    async (tokenDecimals) => {
      mockGetTransactionValues.mockResolvedValue({
        receiverAddress: ACCOUNT_B,
        amount: "1",
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: CONTRACT_C,
          tokenDecimals,
          tokenImage: "",
          tokenBalance: "3",
          tokenBalanceBaseUnits: "3000000",
          tokenName: "Token",
          tokenSymbol: "TOK",
        },
      });
      renderComponent();
      await waitFor(() => {
        expect(
          mockSetTransactionValues.mock.calls.some(([value]) =>
            Object.is(value.tokenDetails?.tokenDecimals, tokenDecimals),
          ),
        ).toBe(true);
      });
      const amount = screen.getByRole("textbox", { name: "amount" });
      await userEvent.clear(amount);
      await userEvent.type(amount, "1");
      expect(screen.getByRole("button", { name: "Send TOK" })).toBeDisabled();
    },
  );

  const fillAndSubmitForm = async (
    buttonName = "Send Quanta",
    amount = "2.5",
  ) => {
    await waitForEditing();
    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(receiverAddressField, ACCOUNT_B);
        await userEvent.type(amountField, amount);
      },
      { timeout: 5000 },
    );
    const sendButton = screen.getByRole("button", { name: buttonName });
    expect(sendButton).toBeEnabled();
    await act(async () => {
      await userEvent.click(sendButton);
    });
  };

  it.each([
    [],
    "invalid",
    { shouldStartFresh: "true" },
    { tokenDetails: null },
    ...[
      { isZrc20Token: "true" },
      { tokenContractAddress: 3 },
      { tokenDecimals: "8" },
      { tokenBalance: 3 },
      { tokenBalanceBaseUnits: 300000000 },
      { tokenName: {} },
      { tokenSymbol: [] },
    ].map((fields) => ({ tokenDetails: { ...TOKEN_DETAILS, ...fields } })),
  ])(
    "preserves the saved draft and blocks malformed route state %j",
    async (state) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockGetTransactionValues.mockResolvedValue({
        receiverAddress: ACCOUNT_B,
        amount: "1",
        tokenDetails: TOKEN_DETAILS,
      });
      const sign = vi.fn();
      renderComponentWithState(
        state,
        mockedStore({
          qrlStore: { signNativeToken: sign, signZrc20Token: sign },
        }),
      );

      expect(
        await screen.findByText(/Invalid transfer navigation state/),
      ).toBeInTheDocument();
      const amount = screen.getByRole("textbox", { name: "amount" });
      fireEvent.change(amount, { target: { value: "2" } });
      expect(
        screen.getByRole("button", { name: "Send Quanta" }),
      ).toBeDisabled();
      const form = amount.closest("form");
      if (!form) throw new Error("Transfer form is missing");
      await act(async () => {
        fireEvent.submit(form);
        await Promise.resolve();
      });
      expect(sign).not.toHaveBeenCalled();
      expect(mockClearTransactionValues).not.toHaveBeenCalled();
      expect(mockSetTransactionValues).not.toHaveBeenCalled();
    },
  );

  it("accepts unknown image metadata and optional base units in route state", async () => {
    const { tokenBalanceBaseUnits: _baseUnits, ...tokenDetails } =
      TOKEN_DETAILS;
    renderComponentWithState({
      tokenDetails: { ...tokenDetails, tokenImage: { source: "legacy" } },
    });
    expect(
      await screen.findByRole("button", { name: "Send TOK" }),
    ).toBeInTheDocument();
    expect(mockSetTransactionValues).toHaveBeenCalledWith({
      receiverAddress: "",
      amount: "",
      tokenDetails: { ...tokenDetails, tokenImage: { source: "legacy" } },
    });
  });

  it.each(["form defaults", "token details", "both"])(
    "reports %s read failures and blocks sending",
    async (failure) => {
      const error = new Error("Draft read failed");
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      if (failure === "form defaults") {
        mockGetTransactionValues.mockRejectedValueOnce(error);
      } else if (failure === "token details") {
        mockGetTransactionValues
          .mockResolvedValueOnce({ receiverAddress: ACCOUNT_B, amount: "1" })
          .mockRejectedValueOnce(error);
      } else {
        mockGetTransactionValues.mockRejectedValue(error);
      }
      renderComponent();

      expect(await screen.findByText(/Draft read failed/)).toBeInTheDocument();
      fireEvent.change(screen.getByRole("textbox", { name: "amount" }), {
        target: { value: "1" },
      });
      expect(
        screen.getByRole("button", { name: "Send Quanta" }),
      ).toBeDisabled();
      expect(log).toHaveBeenCalledWith(
        "[TokenTransfer] Failed to load transfer:",
        error,
      );
      expect(mockClearTransactionValues).not.toHaveBeenCalled();
    },
  );

  it("reports initialization write failures and blocks sending", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockSetTransactionValues.mockRejectedValue(
      new Error("Draft initialization failed"),
    );
    renderComponent();
    expect(
      await screen.findByText(/Draft initialization failed/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Quanta" })).toBeDisabled();
    expect(mockClearTransactionValues).not.toHaveBeenCalled();
  });

  it("reports autosave failures and retains the entered form values", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    renderComponent();
    await waitFor(() => {
      expect(mockSetTransactionValues).toHaveBeenCalled();
    });
    const error = new Error("Draft write failed");
    mockSetTransactionValues.mockRejectedValue(error);
    const amount = screen.getByRole("textbox", { name: "amount" });
    await userEvent.type(amount, "1");

    expect(log).toHaveBeenCalledWith(
      "[TokenTransfer] Failed to save transfer:",
      error,
    );
    expect(amount).toHaveValue("1");
    expect(mockClearTransactionValues).not.toHaveBeenCalled();
  });

  it.each(["amount", "receiverAddress"])(
    "reports a delayed autosave failure after saving a later %s edit",
    async (field) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      mockGetTransactionValues.mockResolvedValue({
        amount: "3",
        receiverAddress: CONTRACT_D,
      });
      renderComponent();
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
          "3",
        );
        expect(
          screen.getByRole("textbox", { name: "receiverAddress" }),
        ).toHaveValue(CONTRACT_D);
      });
      const saving = deferred<undefined>();
      const error = new Error("Earlier draft save failed");
      const failedSave = saving.promise.then(() => {
        throw error;
      });
      mockSetTransactionValues.mockClear().mockReturnValueOnce(failedSave);
      const input = screen.getByRole("textbox", { name: field });
      const first = field === "amount" ? "1" : ACCOUNT_B;
      const second = field === "amount" ? "2" : CONTRACT_C;
      await act(async () => {
        fireEvent.change(input, { target: { value: first } });
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.change(input, { target: { value: second } });
        await Promise.resolve();
      });
      expect(mockSetTransactionValues).toHaveBeenCalledWith(
        expect.objectContaining({ [field]: first }),
      );
      expect(mockSetTransactionValues).toHaveBeenLastCalledWith(
        expect.objectContaining({ [field]: second }),
      );
      await act(async () => {
        saving.resolve(undefined);
        await failedSave.catch(() => {});
      });
      expect(
        log.mock.calls.filter(
          ([message]) => message === "[TokenTransfer] Failed to save transfer:",
        ),
      ).toEqual([["[TokenTransfer] Failed to save transfer:", error]]);
      expect(input).toHaveValue(second);
      expect(input).toBeEnabled();
      expect(mockClearTransactionValues).not.toHaveBeenCalled();
    },
  );

  it("reports token balance refresh failures and retains the restored balance", async () => {
    const error = new Error("Token refresh failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    renderComponentWithState(
      { tokenDetails: TOKEN_DETAILS },
      mockedStore({
        qrlStore: { getZrc20TokenDetails: () => Promise.reject(error) },
      }),
    );
    await screen.findByRole("button", { name: "Send TOK" });
    await userEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue("3");
    expect(log).toHaveBeenCalledWith(
      "[TokenTransfer] Failed to refresh token balance:",
      error,
    );
  });

  it("ignores token balance results from the previously active account", async () => {
    const token = {
      name: "Token",
      symbol: "TOK",
      decimals: 8n,
      totalSupply: 100,
      balance: 2,
      balanceBaseUnits: "200000000",
      image: "",
    };
    const previous =
      deferred<Awaited<ReturnType<QrlStore["getZrc20TokenDetails"]>>>();
    const getDetails = vi
      .fn<QrlStore["getZrc20TokenDetails"]>()
      .mockReturnValueOnce(previous.promise)
      .mockResolvedValue({ token, error: "" });
    const store = mockedStore({
      qrlStore: { getZrc20TokenDetails: getDetails },
    });
    store.qrlStore.activeAccount = observable({ accountAddress: ACCOUNT_A });
    renderComponentWithState({ tokenDetails: TOKEN_DETAILS }, store);
    await waitFor(() => {
      expect(getDetails).toHaveBeenCalledTimes(1);
    });
    act(() => {
      runInAction(() => {
        store.qrlStore.activeAccount.accountAddress = ACCOUNT_B;
      });
    });
    await waitFor(() => {
      expect(getDetails).toHaveBeenCalledTimes(2);
    });
    await userEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue("2");
    await act(async () => {
      previous.resolve({
        token: { ...token, balance: 9, balanceBaseUnits: "900000000" },
        error: "",
      });
      await previous.promise;
    });
    await userEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue("2");
  });

  it("ignores a stale native gas reserve after the fee tier changes", async () => {
    const previous = deferred<string>();
    const getGas = vi.fn<QrlStore["getNativeTokenGas"]>((overrides) =>
      overrides?.tier === "aggressive"
        ? Promise.resolve("3")
        : previous.promise,
    );
    renderComponent(
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "10.0 Quanta",
          getNativeTokenGas: getGas,
        },
      }),
    );
    await waitFor(() => {
      expect(getGas).toHaveBeenCalledWith({ tier: "market" });
    });
    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      ACCOUNT_B,
    );
    await userEvent.type(screen.getByRole("textbox", { name: "amount" }), "1");
    await userEvent.click(screen.getByText("Aggressive"));
    await userEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue("7");
    await act(async () => {
      previous.resolve("9");
      await previous.promise;
    });
    await userEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue("7");
  });

  it("retains the zero gas reserve fallback when native gas estimation fails", async () => {
    const getGas = vi
      .fn<QrlStore["getNativeTokenGas"]>()
      .mockRejectedValue(new Error("Gas estimate failed"));
    renderComponent(
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "10.0 Quanta",
          getNativeTokenGas: getGas,
        },
      }),
    );
    await waitFor(() => {
      expect(getGas).toHaveBeenCalled();
    });
    await userEvent.click(screen.getByRole("button", { name: "Max" }));
    expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue("10");
  });

  it("blurs the amount field on a wheel event", async () => {
    renderComponent();
    const amount = screen.getByRole("textbox", { name: "amount" });
    await userEvent.click(amount);
    expect(amount).toHaveFocus();
    fireEvent.wheel(amount);
    expect(amount).not.toHaveFocus();
  });

  it("reports cancel cleanup failures while navigating home immediately", async () => {
    const error = new Error("Draft clear failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    renderComponentWithState({});
    await waitFor(() => {
      expect(mockSetTransactionValues).toHaveBeenCalled();
    });
    mockClearTransactionValues.mockRejectedValue(error);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("status", { name: "Current route" }),
    ).toHaveTextContent(/^\/$/);
    expect(log).toHaveBeenCalledWith(
      "[TokenTransfer] Failed to clear transfer:",
      error,
    );
  });

  it("saves pending history before broadcasting and clears the draft before navigation", async () => {
    const history = deferred<undefined>();
    const broadcast = deferred<undefined>();
    const clearing = deferred<undefined>();
    const send = vi.fn(() => broadcast.promise);
    renderComponent(
      mockedStore({
        qrlStore: {
          signNativeToken: () => Promise.resolve(successSignResult),
          sendRawTransaction: send,
        },
        transactionHistoryStore: { addTransaction: () => history.promise },
      }),
    );
    mockClearTransactionValues.mockReturnValue(clearing.promise);
    await fillAndSubmitForm();
    expect(send).not.toHaveBeenCalled();
    expect(mockClearTransactionValues).not.toHaveBeenCalled();
    await act(async () => {
      history.resolve(undefined);
      await history.promise;
    });
    expect(send).toHaveBeenCalledExactlyOnceWith("0xraw");
    expect(mockClearTransactionValues).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("status", { name: "Current route" }),
    ).toHaveTextContent(/^\/$/);
    await act(async () => {
      clearing.resolve(undefined);
      await clearing.promise;
    });
    expect(
      screen.getByRole("status", { name: "Current route" }),
    ).toHaveTextContent("/transaction-history");
    await act(async () => {
      broadcast.resolve(undefined);
      await broadcast.promise;
    });
  });

  it.each(["receipt", "broadcast rejection", "account refresh"])(
    "reports background %s handler failures without rewriting transaction status",
    async (failure) => {
      const error = new Error("Background update failed");
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const update = vi.fn(() =>
        failure === "account refresh"
          ? Promise.resolve()
          : Promise.reject(error),
      );
      const refresh = vi
        .fn<QrlStore["fetchAccounts"]>()
        .mockRejectedValue(error);
      const receipt = {
        transactionHash: "0xtxhash",
        status: 1n,
        blockNumber: 100n,
        transactionIndex: 0n,
        blockHash: "0xblock",
        from: ACCOUNT_A,
        to: ACCOUNT_B,
        cumulativeGasUsed: 21000n,
        gasUsed: 21000n,
        logs: [],
        logsBloom: "0x",
        root: "0x",
      };
      renderComponent(
        mockedStore({
          qrlStore: {
            signNativeToken: () => Promise.resolve(successSignResult),
            sendRawTransaction: () =>
              failure === "broadcast rejection"
                ? Promise.reject(new Error("Broadcast failed"))
                : Promise.resolve(receipt),
            fetchAccounts: refresh,
          },
          transactionHistoryStore: { updateTransaction: update },
        }),
      );
      await fillAndSubmitForm();
      await waitFor(() => {
        expect(log).toHaveBeenCalledWith(
          "[TokenTransfer] Failed to update broadcast history:",
          error,
        );
      });
      expect(update).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(
        failure === "account refresh" ? 1 : 0,
      );
      expect(
        screen.getByRole("status", { name: "Current route" }),
      ).toHaveTextContent("/transaction-history");
    },
  );

  it("should render the account details component", async () => {
    renderComponent();
    await waitForEditing();

    expect(screen.getByText("Active account")).toBeInTheDocument();
    expect(screen.getByText("Account address")).toBeInTheDocument();
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("0.0 Quanta")).toBeInTheDocument();
    expect(screen.getByText("Make a transaction")).toBeInTheDocument();
    expect(screen.getByText("Send to")).toBeInTheDocument();
    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    expect(receiverAddressField).toBeInTheDocument();
    expect(receiverAddressField).toBeEnabled();
    expect(screen.getByText("Amount")).toBeInTheDocument();
    const amountField = screen.getByRole("textbox", { name: "amount" });
    expect(amountField).toBeInTheDocument();
    expect(amountField).toBeEnabled();
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    expect(cancelButton).toBeInTheDocument();
    expect(cancelButton).toBeEnabled();
    const sendQuantaButton = screen.getByRole("button", {
      name: "Send Quanta",
    });
    expect(sendQuantaButton).toBeInTheDocument();
    expect(sendQuantaButton).toBeDisabled();
  });

  it("should enable the send quanta button once receiver address, amount and mnemonic phrases are entered", async () => {
    renderComponent();
    await waitForEditing();

    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(receiverAddressField, ACCOUNT_B);
        await userEvent.type(amountField, "2.5");
      },
      { timeout: 5000 },
    );
    const sendQuantaButton = screen.getByRole("button", {
      name: "Send Quanta",
    });
    expect(sendQuantaButton).toBeInTheDocument();
    expect(sendQuantaButton).toBeEnabled();
  });

  it("fails closed with a clear state when QRNS is not configured", async () => {
    renderComponent();
    await waitForEditing();

    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      "alice.qrl",
    );

    expect(
      await screen.findByText("QRNS is not configured for this chain"),
    ).toBeInTheDocument();
    expect(mockResolveQrnsName).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send Quanta" })).toBeDisabled();
  });

  it("binds a configured QRNS result to native signing", async () => {
    mockResolveQrnsName.mockResolvedValue(ACCOUNT_B);
    const mockSignNativeToken = vi.fn().mockResolvedValue(successSignResult);

    renderComponent(
      mockedStore({
        qrlStore: {
          qrlConnection: {
            blockchain: {
              defaultRpcUrl: QRNS_RPC_URL,
              qrnsRegistryAddress: QRNS_REGISTRY,
            },
          },
          signNativeToken: mockSignNativeToken,
          sendRawTransaction: vi.fn().mockResolvedValue(undefined),
        },
      }),
    );
    await waitForEditing();

    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      "alice.qrl",
    );
    await userEvent.type(screen.getByRole("textbox", { name: "amount" }), "1");

    await waitFor(
      () => {
        expect(mockResolveQrnsName).toHaveBeenCalledWith(
          "alice.qrl",
          expect.objectContaining({
            chainId: "0x301825",
            defaultRpcUrl: QRNS_RPC_URL,
            qrnsRegistryAddress: QRNS_REGISTRY,
          }),
        );
        expect(
          screen.getByText(formatQrlAddressFingerprint(ACCOUNT_B)),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Show full address" }),
    );
    expect(
      within(screen.getByTestId("address-disclosure-full")).getByTitle(
        ACCOUNT_B,
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Send Quanta" }));
    await waitFor(() => {
      expect(mockSignNativeToken).toHaveBeenCalledWith(
        ACCOUNT_A,
        ACCOUNT_B,
        "1",
        expect.any(String),
        // The stored default gas tier is applied on mount, so every send
        // carries it. Before this fix the overrides stayed undefined and
        // the store fell back to market.
        { tier: "market" },
      );
    });
  });

  it("uses the bound QRNS address for ZRC-20 gas estimation", async () => {
    mockResolveQrnsName.mockResolvedValue(ACCOUNT_B);
    const mockGetZrc20TokenGas = vi.fn().mockResolvedValue("0.001");

    renderComponentWithState(
      {
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: CONTRACT_C,
          tokenDecimals: 18,
          tokenImage: "token.png",
          tokenBalance: "100.0 TST",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      },
      mockedStore({
        qrlStore: {
          qrlConnection: {
            blockchain: {
              defaultRpcUrl: QRNS_RPC_URL,
              qrnsRegistryAddress: QRNS_REGISTRY,
            },
          },
          getAccountBalance: () => "10.0 Quanta",
          getZrc20TokenGas: mockGetZrc20TokenGas,
        },
      }),
    );
    await waitForEditing();

    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      "alice.qrl",
    );
    await userEvent.type(screen.getByRole("textbox", { name: "amount" }), "1");

    await waitFor(
      () => {
        expect(mockGetZrc20TokenGas).toHaveBeenCalledWith(
          ACCOUNT_A,
          ACCOUNT_B,
          "1",
          CONTRACT_C,
          18,
          { tier: "market" },
        );
      },
      { timeout: 3000 },
    );
  });

  it("ignores an older in-flight QRNS result after the name changes", async () => {
    const alice = deferred<string>();
    const bob = deferred<string>();
    mockResolveQrnsName
      .mockReturnValueOnce(alice.promise)
      .mockReturnValueOnce(bob.promise);

    renderComponent(
      mockedStore({
        qrlStore: {
          qrlConnection: {
            blockchain: {
              defaultRpcUrl: QRNS_RPC_URL,
              qrnsRegistryAddress: QRNS_REGISTRY,
            },
          },
        },
      }),
    );
    await waitForEditing();

    const receiver = screen.getByRole("textbox", { name: "receiverAddress" });
    await userEvent.type(receiver, "alice.qrl");
    await waitFor(
      () => {
        expect(mockResolveQrnsName).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 },
    );

    await userEvent.clear(receiver);
    await userEvent.type(receiver, "bob.qrl");
    await waitFor(
      () => {
        expect(mockResolveQrnsName).toHaveBeenCalledTimes(2);
      },
      { timeout: 3000 },
    );

    await act(async () => {
      bob.resolve(CONTRACT_C);
      await bob.promise;
    });
    expect(
      await screen.findByText(formatQrlAddressFingerprint(CONTRACT_C)),
    ).toBeInTheDocument();

    await act(async () => {
      alice.resolve(ACCOUNT_B);
      await alice.promise;
    });
    expect(
      screen.getByText(formatQrlAddressFingerprint(CONTRACT_C)),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(formatQrlAddressFingerprint(ACCOUNT_B)),
    ).not.toBeInTheDocument();
  });

  it("should display the error message if amount is not valid", async () => {
    renderComponent();
    await waitForEditing();

    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(async () => {
      await userEvent.type(amountField, "-2.5");
    });
    expect(
      screen.getByText("Amount should be more than 0"),
    ).toBeInTheDocument();
  });

  it("should sign and add pending transaction for Ledger account", async () => {
    const mockAddTransaction = vi.fn().mockResolvedValue(undefined);
    const validRawTxHex = "0x02f8a00180843b9aca00843b9aca0082520894";

    const store = mockedStore({
      ledgerStore: {
        isLedgerAccount: () => true,
        signAndSerializeTransaction: () => Promise.resolve(validRawTxHex),
      },
      qrlStore: {
        sendRawTransaction: vi.fn().mockResolvedValue(undefined),
      },
      transactionHistoryStore: {
        addTransaction: mockAddTransaction,
      },
    });
    const instance = new Web3().qrl;
    vi.spyOn(instance, "getTransactionCount").mockResolvedValue(0n);
    vi.spyOn(instance, "getChainId").mockResolvedValue(1n);
    store.qrlStore.qrlInstance = instance;
    renderComponent(store);
    await waitForEditing();

    await fillAndSubmitForm();
    expect(mockAddTransaction).toHaveBeenCalledWith(
      ACCOUNT_A,
      expect.objectContaining({
        pendingStatus: "pending",
        status: false,
        tokenSymbol: "Quanta",
      }),
    );
  });

  it("should display error when Ledger signing fails", async () => {
    const store = mockedStore({
      ledgerStore: {
        isLedgerAccount: () => true,
        signAndSerializeTransaction: () =>
          Promise.reject(new Error("User rejected on device")),
      },
    });
    const instance = new Web3().qrl;
    vi.spyOn(instance, "getTransactionCount").mockResolvedValue(0n);
    vi.spyOn(instance, "getChainId").mockResolvedValue(1n);
    store.qrlStore.qrlInstance = instance;
    renderComponent(store);
    await waitForEditing();

    await fillAndSubmitForm();
    expect(screen.getByText(/User rejected on device/)).toBeInTheDocument();
  });

  it("should add pending transaction and navigate home on successful sign", async () => {
    const mockAddTransaction = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      mockedStore({
        qrlStore: {
          signNativeToken: () => Promise.resolve(successSignResult),
          sendRawTransaction: vi.fn().mockResolvedValue(undefined),
        },
        transactionHistoryStore: {
          addTransaction: mockAddTransaction,
        },
      }),
    );
    await waitForEditing();

    await fillAndSubmitForm();
    expect(mockAddTransaction).toHaveBeenCalledWith(
      ACCOUNT_A,
      expect.objectContaining({
        transactionHash: "0xtxhash",
        pendingStatus: "pending",
        status: false,
      }),
    );
  });

  it.each(["0.0000001", "0.123456789012345678"])(
    "passes exact amount text %s through the form into signing and history",
    async (amount) => {
      const sign = vi.fn().mockResolvedValue(successSignResult);
      const add = vi.fn().mockResolvedValue(undefined);
      renderComponent(
        mockedStore({
          qrlStore: {
            signNativeToken: sign,
            sendRawTransaction: vi.fn().mockResolvedValue(undefined),
          },
          transactionHistoryStore: { addTransaction: add },
        }),
      );
      await waitForEditing();
      await fillAndSubmitForm("Send Quanta", amount);
      expect(sign).toHaveBeenCalledWith(
        ACCOUNT_A,
        ACCOUNT_B,
        amount,
        expect.any(String),
        { tier: "market" },
      );
      expect(add).toHaveBeenCalledWith(
        ACCOUNT_A,
        expect.objectContaining({ amount, pendingStatus: "pending" }),
      );
    },
  );

  it.each([
    [
      new Error("Receipt polling timed out"),
      { pendingStatus: "unknown", status: false },
    ],
    [
      { code: -32602, message: "Invalid transaction" },
      { pendingStatus: "failed", status: false, submissionRejected: true },
    ],
    [
      {
        receipt: { transactionHash: "0xtxhash", status: 0n, blockNumber: 100n },
      },
      {
        pendingStatus: "failed",
        status: false,
        receiptStatusVerified: true,
        blockNumber: "100",
      },
    ],
  ])(
    "classifies broadcast completion with receipt evidence: %p",
    async (error, expected) => {
      const update = vi.fn().mockResolvedValue(undefined);
      renderComponent(
        mockedStore({
          qrlStore: {
            signNativeToken: () => Promise.resolve(successSignResult),
            sendRawTransaction: vi.fn().mockRejectedValue(error),
          },
          transactionHistoryStore: { updateTransaction: update },
        }),
      );
      await waitForEditing();
      await fillAndSubmitForm();
      await waitFor(() => {
        expect(update).toHaveBeenCalledWith(
          ACCOUNT_A,
          "0xtxhash",
          expect.objectContaining(expected),
        );
      });
    },
  );

  it.each([
    ["0.0000001", 18],
    ["9007199254740993", 0],
  ])(
    "preserves token input %s at %s decimals through form submission",
    async (amount, decimals) => {
      const sign = vi.fn().mockResolvedValue(successSignResult);
      renderComponentWithState(
        {
          tokenDetails: {
            isZrc20Token: true,
            tokenContractAddress: CONTRACT_C,
            tokenDecimals: decimals,
            tokenImage: "token.png",
            tokenBalance: "10000000000000000 TST",
            tokenName: "Test Token",
            tokenSymbol: "TST",
          },
        },
        mockedStore({
          qrlStore: {
            signZrc20Token: sign,
            sendRawTransaction: vi.fn().mockResolvedValue(undefined),
          },
        }),
      );
      await waitForEditing();
      await screen.findByRole("button", { name: "Send TST" });
      await fillAndSubmitForm("Send TST", amount);
      expect(sign).toHaveBeenCalledWith(
        ACCOUNT_A,
        ACCOUNT_B,
        amount,
        expect.any(String),
        CONTRACT_C,
        decimals,
        { tier: "market" },
      );
    },
  );

  it("rejects fractional zero-decimal token input without signing", async () => {
    const sign = vi.fn();
    renderComponentWithState(
      {
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: CONTRACT_C,
          tokenDecimals: 0,
          tokenImage: "token.png",
          tokenBalance: "10 TST",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      },
      mockedStore({ qrlStore: { signZrc20Token: sign } }),
    );
    await waitForEditing();
    await screen.findByRole("button", { name: "Send TST" });
    await waitFor(
      async () => {
        await userEvent.type(
          screen.getByRole("textbox", { name: "receiverAddress" }),
          ACCOUNT_B,
        );
        await userEvent.type(
          screen.getByRole("textbox", { name: "amount" }),
          "1.1",
        );
      },
      { timeout: 5000 },
    );

    // Caught by the form schema while typing, so Send never becomes
    // pressable and the user is told before they commit to anything.
    expect(
      await screen.findByText(/at most 0 decimal places/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send TST" })).toBeDisabled();
    expect(sign).not.toHaveBeenCalled();
  });

  describe("token balances below the display rounding", () => {
    // 0.00005 of an 8-decimal token. getOptimalTokenBalance renders four
    // decimals, so the display string is "0.0 MQW" and every comparison
    // made against it read the balance as zero.
    const SMALL_BALANCE_DETAILS = {
      isZrc20Token: true,
      tokenContractAddress: CONTRACT_D,
      tokenDecimals: 8,
      tokenImage: "token.png",
      tokenBalance: "0.0 MQW",
      tokenBalanceBaseUnits: "5000",
      tokenName: "Mini Token",
      tokenSymbol: "MQW",
    };

    it("sends an amount within a balance the display rounds to zero", async () => {
      const sign = vi.fn().mockResolvedValue(successSignResult);
      renderComponentWithState(
        { tokenDetails: SMALL_BALANCE_DETAILS },
        mockedStore({
          qrlStore: {
            signZrc20Token: sign,
            getAccountBalance: () => "10.0 Quanta",
            getZrc20TokenGas: () => Promise.resolve("0.001"),
            sendRawTransaction: vi.fn().mockResolvedValue(undefined),
          },
        }),
      );
      await waitForEditing();

      await screen.findByRole("button", { name: "Send MQW" });
      await fillAndSubmitForm("Send MQW", "0.00005");

      expect(
        screen.queryByText("Insufficient MQW balance"),
      ).not.toBeInTheDocument();
      expect(sign).toHaveBeenCalledWith(
        ACCOUNT_A,
        ACCOUNT_B,
        "0.00005",
        expect.any(String),
        CONTRACT_D,
        8,
        { tier: "market" },
      );
    });

    it("still refuses an amount above that balance", async () => {
      const sign = vi.fn().mockResolvedValue(successSignResult);
      renderComponentWithState(
        { tokenDetails: SMALL_BALANCE_DETAILS },
        mockedStore({
          qrlStore: {
            signZrc20Token: sign,
            getAccountBalance: () => "10.0 Quanta",
            getZrc20TokenGas: () => Promise.resolve("0.001"),
          },
        }),
      );
      await waitForEditing();

      await screen.findByRole("button", { name: "Send MQW" });
      await waitFor(
        async () => {
          await userEvent.type(
            screen.getByRole("textbox", { name: "receiverAddress" }),
            ACCOUNT_B,
          );
          await userEvent.type(
            screen.getByRole("textbox", { name: "amount" }),
            "0.0001",
          );
        },
        { timeout: 5000 },
      );

      expect(
        await screen.findByText("Insufficient MQW balance"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send MQW" })).toBeDisabled();
      expect(sign).not.toHaveBeenCalled();
    });

    it("leaves no dust behind when Max is pressed", async () => {
      renderComponentWithState(
        { tokenDetails: SMALL_BALANCE_DETAILS },
        mockedStore({
          qrlStore: {
            getAccountBalance: () => "10.0 Quanta",
            getZrc20TokenGas: () => Promise.resolve("0.001"),
          },
        }),
      );
      await waitForEditing();

      await screen.findByRole("button", { name: "Send MQW" });
      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Max" }));
      });

      expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
        "0.00005",
      );
    });
  });

  describe("token ceilings from a cold open", () => {
    // 24 decimals, one unit above a whole token. BigNumber's global
    // DECIMAL_PLACES is 18 with ROUND_DOWN, so dividing by 10^24 dropped
    // that trailing unit and Max left dust behind.
    const WIDE_DECIMALS_DETAILS = {
      isZrc20Token: true,
      tokenContractAddress: CONTRACT_D,
      tokenDecimals: 24,
      tokenImage: "token.png",
      tokenBalance: "1.0 WIDE",
      tokenBalanceBaseUnits: "1000000000000000000000001",
      tokenName: "Wide Token",
      tokenSymbol: "WIDE",
    };

    it("spends a >18-decimal balance to the last unit on Max", async () => {
      renderComponentWithState(
        { tokenDetails: WIDE_DECIMALS_DETAILS },
        mockedStore({
          qrlStore: {
            getAccountBalance: () => "10.0 Quanta",
            getZrc20TokenGas: () => Promise.resolve("0.001"),
          },
        }),
      );
      await waitForEditing();

      await screen.findByRole("button", { name: "Send WIDE" });
      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Max" }));
      });

      expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
        "1.000000000000000000000001",
      );
    });

    it("refuses a send against a restored ceiling the chain no longer backs", async () => {
      const sign = vi.fn().mockResolvedValue(successSignResult);
      // Storage still holds a whole token from an earlier session; the
      // chain says half of it is left. A stale ceiling let the send pass
      // this guard and revert on chain, burning the fee.
      const getZrc20TokenDetails = vi.fn().mockResolvedValue({
        token: {
          balance: 0.5,
          balanceBaseUnits: "50000000",
          decimals: BigInt(8),
          name: "Mini Token",
          symbol: "MQW",
          totalSupply: 1000,
          image: "",
        },
        error: "",
      });

      renderComponentWithState(
        {
          tokenDetails: {
            isZrc20Token: true,
            tokenContractAddress: CONTRACT_D,
            tokenDecimals: 8,
            tokenImage: "token.png",
            tokenBalance: "1.0 MQW",
            tokenBalanceBaseUnits: "100000000",
            tokenName: "Mini Token",
            tokenSymbol: "MQW",
          },
        },
        mockedStore({
          qrlStore: {
            signZrc20Token: sign,
            getZrc20TokenDetails,
            getAccountBalance: () => "10.0 Quanta",
            getZrc20TokenGas: () => Promise.resolve("0.001"),
          },
        }),
      );
      await waitForEditing();

      await screen.findByRole("button", { name: "Send MQW" });
      await waitFor(() => {
        expect(getZrc20TokenDetails).toHaveBeenCalledWith(CONTRACT_D);
      });

      await waitFor(
        async () => {
          await userEvent.type(
            screen.getByRole("textbox", { name: "receiverAddress" }),
            ACCOUNT_B,
          );
          await userEvent.type(
            screen.getByRole("textbox", { name: "amount" }),
            "0.8",
          );
        },
        { timeout: 5000 },
      );

      expect(
        await screen.findByText("Insufficient MQW balance"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Send MQW" })).toBeDisabled();
      expect(sign).not.toHaveBeenCalled();
    });
  });

  it("warns on the send form while the balances are stale, without blocking Send", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "10.0 Quanta",
          qrlConnection: {
            // The node answers net_listening while qrl_getBalance keeps
            // failing, so the chain reads as connected and the amounts on
            // screen are old.
            isConnected: true,
            isLoading: false,
            areBalancesStale: true,
            blockchain: { chainId: "0x1" },
          },
        },
      }),
    );
    await waitForEditing();

    expect(
      await screen.findByText(
        "The node is not answering, so this balance may be out of date.",
      ),
    ).toBeInTheDocument();

    await fillAndSubmitForm("Send Quanta", "1");
  });

  it("shows no stale warning while the balances are current", async () => {
    renderComponent(
      mockedStore({ qrlStore: { getAccountBalance: () => "10.0 Quanta" } }),
    );
    await waitForEditing();

    expect(
      screen.queryByText(
        "The node is not answering, so this balance may be out of date.",
      ),
    ).not.toBeInTheDocument();
  });

  it("re-applies Max when a dearer gas tier raises the reserve", async () => {
    const getNativeTokenGas = vi.fn((overrides?: { tier?: string }) =>
      Promise.resolve(overrides?.tier === "aggressive" ? "3" : "1"),
    );
    renderComponent(
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "10.0 Quanta",
          getNativeTokenGas,
        },
      }),
    );
    await waitForEditing();

    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      ACCOUNT_B,
    );
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Max" }));
    });

    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(() => expect(amountField).toHaveValue("9"));

    // Raising the tier raises the reserve, so the amount Max picked under
    // the cheaper tier no longer leaves enough for gas.
    await act(async () => {
      await userEvent.click(screen.getByText("Aggressive"));
    });

    await waitFor(() => expect(amountField).toHaveValue("7"));
  });

  it("refuses a Ledger account a token transfer with an explicit message", async () => {
    const sign = vi.fn();
    renderComponentWithState(
      {
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: CONTRACT_C,
          tokenDecimals: 18,
          tokenImage: "token.png",
          tokenBalance: "100.0 TST",
          tokenBalanceBaseUnits: "100000000000000000000",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      },
      mockedStore({
        ledgerStore: { isLedgerAccount: () => true },
        qrlStore: {
          signZrc20Token: sign,
          getAccountBalance: () => "10.0 Quanta",
          getZrc20TokenGas: () => Promise.resolve("0.001"),
        },
      }),
    );
    await waitForEditing();

    await screen.findByRole("button", { name: "Send TST" });
    await fillAndSubmitForm("Send TST", "1");

    expect(sign).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Sending tokens from a Ledger account/),
    ).toBeInTheDocument();
  });

  it("should call addTransaction with pending entry on successful sign", async () => {
    const mockAddTransaction = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      mockedStore({
        qrlStore: {
          signNativeToken: () => Promise.resolve(successSignResult),
          sendRawTransaction: vi.fn().mockResolvedValue(undefined),
        },
        transactionHistoryStore: {
          addTransaction: mockAddTransaction,
        },
      }),
    );
    await waitForEditing();

    await fillAndSubmitForm();
    expect(mockAddTransaction).toHaveBeenCalledWith(
      ACCOUNT_A,
      expect.objectContaining({
        transactionHash: "0xtxhash",
        pendingStatus: "pending",
        tokenSymbol: "Quanta",
        blockNumber: "",
        gasUsed: "",
      }),
    );
  });

  it("should navigate home when cancel button is clicked", async () => {
    renderComponent();
    await waitForEditing();

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    await act(async () => {
      await userEvent.click(cancelButton);
    });
    expect(mockClearTransactionValues).toHaveBeenCalled();
  });

  it("should display error when signing returns an error", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          signNativeToken: () =>
            Promise.resolve({
              error: "Insufficient funds",
            }),
        },
      }),
    );
    await waitForEditing();

    await fillAndSubmitForm();
    expect(screen.getByText(/Insufficient funds/)).toBeInTheDocument();
  });

  it("should display error when onSubmit throws an exception", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          signNativeToken: () => Promise.reject(new Error("Network timeout")),
        },
      }),
    );
    await waitForEditing();

    await fillAndSubmitForm();
    expect(screen.getByText(/Network timeout/)).toBeInTheDocument();
  });

  it("shows a translated locked-wallet message and re-polls lock state when signing hits a locked wallet (L4)", async () => {
    const mockReadLockState = vi.fn().mockResolvedValue(undefined);

    renderComponent(
      mockedStore({
        lockStore: {
          getMnemonicPhrases: vi
            .fn()
            .mockRejectedValue(new Error("MyQRLWallet is locked")),
          readLockState: mockReadLockState,
        },
      }),
    );
    await waitForEditing();

    await fillAndSubmitForm();

    expect(
      screen.getByText("The wallet is locked. Unlock it to continue."),
    ).toBeInTheDocument();
    expect(mockReadLockState).toHaveBeenCalled();
  });

  it("should sign ZRC20 token and add pending transaction when token details are set from state", async () => {
    const mockSignZrc20Token = vi.fn().mockResolvedValue({
      ...successSignResult,
      data: "0xcontractdata",
    });
    const mockAddTransaction = vi.fn().mockResolvedValue(undefined);

    renderComponentWithState(
      {
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: CONTRACT_C,
          tokenDecimals: 18,
          tokenImage: "token.png",
          tokenBalance: "100.0",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      },
      mockedStore({
        qrlStore: {
          signZrc20Token: mockSignZrc20Token,
          sendRawTransaction: vi.fn().mockResolvedValue(undefined),
        },
        transactionHistoryStore: {
          addTransaction: mockAddTransaction,
        },
      }),
    );
    await waitForEditing();

    await waitFor(() => {
      expect(screen.getByText("Send TST")).toBeInTheDocument();
    });

    await fillAndSubmitForm("Send TST");
    expect(mockSignZrc20Token).toHaveBeenCalled();
    expect(mockAddTransaction).toHaveBeenCalledWith(
      ACCOUNT_A,
      expect.objectContaining({
        pendingStatus: "pending",
        tokenSymbol: "TST",
      }),
    );
  });

  it("should load token details from storage when no state is provided", async () => {
    mockGetTransactionValues.mockResolvedValue({
      receiverAddress: "",
      amount: 0,
      tokenDetails: {
        isZrc20Token: true,
        tokenContractAddress: CONTRACT_D,
        tokenDecimals: 8,
        tokenImage: "stored-token.png",
        tokenBalance: "200.0",
        tokenName: "Stored Token",
        tokenSymbol: "STK",
      },
    });

    renderComponent();
    await waitForEditing();

    await waitFor(() => {
      expect(screen.getByText("Send STK")).toBeInTheDocument();
    });
  });

  it("should reset form when shouldStartFresh state is true", async () => {
    renderComponentWithState({ shouldStartFresh: true });
    await waitForEditing();

    await waitFor(() => {
      expect(mockClearTransactionValues).toHaveBeenCalled();
    });
  });

  it("clears the insufficient-balance error once the balance catches up", async () => {
    const balances = new ObservableBalances({ [ACCOUNT_A]: "5.0 Quanta" });
    renderComponent(
      mockedStore({
        qrlStore: {
          getAccountBalance: balances.getAccountBalance,
          getNativeTokenGas: vi.fn(() => Promise.resolve("0.001")),
        },
      }),
    );
    await waitForEditing();

    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(receiverAddressField, ACCOUNT_B);
        await userEvent.type(amountField, "10");
      },
      { timeout: 5000 },
    );

    await waitFor(
      () => {
        expect(
          screen.getByText(
            "Insufficient Quanta balance (amount + gas fee exceeds balance)",
          ),
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    // The guard read the balance from an effect whose dependency list left
    // it out, so an incoming transfer left the form refusing a send it
    // could now afford.
    act(() => {
      balances.set(ACCOUNT_A, "100.0 Quanta");
    });

    await waitFor(
      () => {
        expect(
          screen.queryByText(
            "Insufficient Quanta balance (amount + gas fee exceeds balance)",
          ),
        ).not.toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it("should display insufficient balance error when native Quanta amount exceeds balance", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "5.0 Quanta",
          getNativeTokenGas: vi.fn(() => Promise.resolve("0.001")),
        },
      }),
    );
    await waitForEditing();

    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(receiverAddressField, ACCOUNT_B);
        await userEvent.type(amountField, "10");
      },
      { timeout: 5000 },
    );

    await waitFor(
      () => {
        expect(
          screen.getByText(
            "Insufficient Quanta balance (amount + gas fee exceeds balance)",
          ),
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );

    const sendButton = screen.getByRole("button", { name: "Send Quanta" });
    expect(sendButton).toBeDisabled();
  });

  it("should not display balance error when amount is within balance", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "100.0 Quanta",
          getNativeTokenGas: vi.fn(() => Promise.resolve("0.001")),
        },
      }),
    );
    await waitForEditing();

    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(receiverAddressField, ACCOUNT_B);
        await userEvent.type(amountField, "5");
      },
      { timeout: 5000 },
    );

    await waitFor(() => {
      expect(screen.getByText("Gas fee")).toBeInTheDocument();
      expect(screen.getByText("Low")).toBeInTheDocument();
      expect(screen.getByText("Market")).toBeInTheDocument();
      expect(screen.getByText("Aggressive")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Insufficient/)).not.toBeInTheDocument();

    const sendButton = screen.getByRole("button", { name: "Send Quanta" });
    expect(sendButton).toBeEnabled();
  });

  it("should display insufficient token balance error for ZRC-20 when amount exceeds token balance", async () => {
    renderComponentWithState(
      {
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: CONTRACT_C,
          tokenDecimals: 18,
          tokenImage: "token.png",
          tokenBalance: "50.0 TST",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      },
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "10.0 Quanta",
          getZrc20TokenGas: vi.fn(() => Promise.resolve("0.001")),
        },
      }),
    );
    await waitForEditing();

    await waitFor(() => {
      expect(screen.getByText("Send TST")).toBeInTheDocument();
    });

    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(receiverAddressField, ACCOUNT_B);
        await userEvent.type(amountField, "100");
      },
      { timeout: 5000 },
    );

    await waitFor(
      () => {
        expect(
          screen.getByText("Insufficient TST balance"),
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  it("should display insufficient gas error for ZRC-20 when native balance cannot cover gas", async () => {
    renderComponentWithState(
      {
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: CONTRACT_C,
          tokenDecimals: 18,
          tokenImage: "token.png",
          tokenBalance: "1,000.0 TST",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      },
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "0.0 Quanta",
          getZrc20TokenGas: vi.fn(() => Promise.resolve("0.001")),
        },
      }),
    );
    await waitForEditing();

    await waitFor(() => {
      expect(screen.getByText("Send TST")).toBeInTheDocument();
    });

    const receiverAddressField = screen.getByRole("textbox", {
      name: "receiverAddress",
    });
    const amountField = screen.getByRole("textbox", { name: "amount" });
    await waitFor(
      async () => {
        await userEvent.type(receiverAddressField, ACCOUNT_B);
        await userEvent.type(amountField, "10");
      },
      { timeout: 5000 },
    );

    await waitFor(
      () => {
        expect(
          screen.getByText("Insufficient Quanta for gas fee"),
        ).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });

  describe("balance slider", () => {
    it("should fill the full native balance on Max when no gas reserve is known", async () => {
      renderComponent(
        mockedStore({
          qrlStore: {
            getAccountBalance: () => "100.0 Quanta",
          },
        }),
      );
      await waitForEditing();

      const maxButton = await screen.findByRole("button", { name: "Max" });
      await userEvent.click(maxButton);

      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
          "100",
        );
      });
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("should subtract the native gas reserve from Max", async () => {
      renderComponent(
        mockedStore({
          qrlStore: {
            getAccountBalance: () => "10.0 Quanta",
            getNativeTokenGas: () => Promise.resolve("0.5"),
          },
        }),
      );
      await waitForEditing();

      const maxButton = await screen.findByRole("button", { name: "Max" });
      // The reserve estimate is async; retry Max until it reflects it.
      await waitFor(async () => {
        await userEvent.click(maxButton);
        expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
          "9.5",
        );
      });
    });

    it("uses the balance as it is at the moment Max is pressed", async () => {
      const balances = new ObservableBalances({ [ACCOUNT_A]: "10.0 Quanta" });
      renderComponent(
        mockedStore({
          qrlStore: { getAccountBalance: balances.getAccountBalance },
        }),
      );
      await waitForEditing();

      const maxButton = await screen.findByRole("button", { name: "Max" });
      await userEvent.click(maxButton);
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
          "10",
        );
      });

      // A poll tick or a confirmed send lands. Max read the balance from a
      // memo whose dependencies never mentioned it, so it kept spending the
      // old number.
      act(() => {
        balances.set(ACCOUNT_A, "70.0 Quanta");
      });

      await userEvent.click(maxButton);
      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
          "70",
        );
      });
    });

    it("should apply a quick percentage of the balance", async () => {
      renderComponent(
        mockedStore({
          qrlStore: {
            getAccountBalance: () => "100.0 Quanta",
          },
        }),
      );
      await waitForEditing();

      const quarterButton = await screen.findByRole("button", {
        name: "25%",
      });
      await userEvent.click(quarterButton);

      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
          "25",
        );
      });
    });

    it("should use the full token balance for Max on ZRC-20 transfers", async () => {
      renderComponentWithState({
        tokenDetails: {
          isZrc20Token: true,
          tokenContractAddress: CONTRACT_C,
          tokenDecimals: 18,
          tokenImage: "token.png",
          tokenBalance: "50.0 TST",
          tokenName: "Test Token",
          tokenSymbol: "TST",
        },
      });
      await waitForEditing();

      await waitFor(() => {
        expect(screen.getByText("Send TST")).toBeInTheDocument();
      });
      await userEvent.click(screen.getByRole("button", { name: "Max" }));

      await waitFor(() => {
        expect(screen.getByRole("textbox", { name: "amount" })).toHaveValue(
          "50",
        );
      });
    });
  });
});
