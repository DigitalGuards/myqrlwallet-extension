import Web3 from "@theqrl/web3";
import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import type DAppRequestStore from "@/stores/dAppRequestStore";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { DEFAULT_BLOCKCHAIN } from "@/configuration/qrlBlockchainConfig";
import { revalidateAuthorizedDAppRequest } from "@/scripts/utils/restrictedMethodsMiddlewareUtils";
import StorageUtil from "@/utilities/storageUtil";
import {
  EFFECTIVELY_UNLIMITED_THRESHOLD,
  MAX_UINT256,
} from "@/functions/decodeTransactionCalldata";
import {
  encodeFunctionSignature,
  encodeParameters,
} from "@theqrl/web3-qrl-abi";
import { toChecksumAddress } from "@theqrl/wallet.js";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalldataSummary from "./CalldataSummary";
import QrlSendTransaction from "../QrlSendTransaction";

vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: () => "synthetic-test-seed",
}));

vi.mock(import("@/configuration/releaseProfile"), async (importOriginal) => ({
  ...(await importOriginal()),
  assertV3Network: vi.fn().mockResolvedValue(undefined),
}));

const SPENDER = `Q${"ab".repeat(64)}`;
const RECIPIENT = `Q${"cd".repeat(64)}`;
const SOURCE = `Q${"ef".repeat(64)}`;
const CONTRACT = `Q${"12".repeat(64)}`;
const OTHER_CONTRACT = `Q${"56".repeat(64)}`;
const OWNER = `Q${"34".repeat(64)}`;

const call = (signature: string, types: string[], values: unknown[]) =>
  `${encodeFunctionSignature(signature)}${encodeParameters(types, values).slice(2)}`;

const UNLIMITED_WARNING =
  "This allows spending more than the token's entire supply. It is effectively unlimited: the spender can move your whole balance at any time, now and in the future.";
const AMBIGUOUS_UNLIMITED_WARNING =
  "If this contract is a token, this allows spending more than its entire supply and is effectively unlimited. If it is an NFT collection, the number below is a token ID.";
const APPROVE_CAUTION =
  "The wallet does not know this contract. If it is a token, the number below is an amount. If it is an NFT collection, it is the ID of one item, and approving hands that exact item to the spender.";
const APPROVE_CAUTION_NFT_REPORTED =
  "The wallet does not know this contract. The contract reports it is an NFT collection, so the number below may be the ID of one item. A contract can report whatever it likes, so import the collection to settle it.";

const word = (value: bigint) => `0x${value.toString(16).padStart(128, "0")}`;

const MQW_TOKEN = {
  address: CONTRACT,
  symbol: "MQW",
  decimals: 18,
  image: "",
};

const RELIC_COLLECTION = {
  address: CONTRACT,
  name: "Quanta Relics",
  symbol: "RELIC",
  standard: "ZRC721" as const,
  image: "",
};

/**
 * The read-only contract probe. `supportsInterface(bytes4)` is 0x01ffc9a7
 * and `totalSupply()` is 0x18160ddd, so the stub answers on the selector
 * the surface asks with.
 */
const createProbeStore = () => {
  const store = mockedStore();
  const instance = new Web3().qrl;
  const probe = vi.spyOn(instance, "call");
  store.qrlStore.qrlInstance = instance;
  return { store, probe };
};

const probingStore = ({
  isNft,
  totalSupply,
}: {
  isNft?: boolean;
  totalSupply?: bigint;
} = {}) => {
  const { store, probe } = createProbeStore();
  probe.mockImplementation((transaction) => {
    const selector =
      typeof transaction.data === "string"
        ? transaction.data.slice(0, 10)
        : undefined;
    if (selector === "0x01ffc9a7") {
      return Promise.resolve(
        isNft === undefined ? "0x" : word(isNft ? 1n : 0n),
      );
    }
    if (selector === "0x18160ddd") {
      return Promise.resolve(
        totalSupply === undefined ? "0x" : word(totalSupply),
      );
    }
    return Promise.resolve("0x");
  });
  return store;
};

const renderSummary = (
  data: string,
  storeValues = mockedStore(),
  contractAddress = CONTRACT,
) =>
  render(
    <StoreProvider value={storeValues}>
      <MemoryRouter>
        <CalldataSummary
          data={data}
          contractAddress={contractAddress}
          fromAddress={OWNER}
        />
      </MemoryRouter>
    </StoreProvider>,
  );

describe("CalldataSummary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(StorageUtil, "getTokenContractsList").mockResolvedValue([]);
    vi.spyOn(StorageUtil, "getNFTCollectionsList").mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when there is no calldata", () => {
    const { container } = renderSummary("0x");

    expect(container).toBeEmptyDOMElement();
  });

  it("names the token amount when the contract is a known token", async () => {
    vi.spyOn(StorageUtil, "getTokenContractsList").mockResolvedValue([
      { address: CONTRACT, symbol: "MQW", decimals: 18, image: "" },
    ]);

    renderSummary(
      call(
        "transfer(address,uint256)",
        ["address", "uint256"],
        [RECIPIENT, "1500000000000000000"],
      ),
    );

    expect(await screen.findByText("1.5 MQW")).toBeInTheDocument();
    expect(screen.getByText("Transfer tokens")).toBeInTheDocument();
    expect(screen.getByText("Recipient")).toBeInTheDocument();
    expect(screen.getByText(toChecksumAddress(RECIPIENT))).toBeInTheDocument();
  });

  it.each([null, Number.NaN, Infinity])(
    "shows base units when stored decimals are %s",
    async (decimals) => {
      vi.spyOn(StorageUtil, "getTokenContractsList").mockResolvedValue([
        { ...MQW_TOKEN, decimals },
      ]);
      await act(() => {
        renderSummary(
          call(
            "transfer(address,uint256)",
            ["address", "uint256"],
            [RECIPIENT, "1500000000000000000"],
          ),
        );
        return Promise.resolve();
      });
      expect(
        screen.getByText("1500000000000000000 base units"),
      ).toBeInTheDocument();
      expect(screen.queryByText("1.5 MQW")).not.toBeInTheDocument();
    },
  );

  it("falls back to base units when the token is unknown", async () => {
    renderSummary(
      call(
        "transfer(address,uint256)",
        ["address", "uint256"],
        [RECIPIENT, "1500000000000000000"],
      ),
    );

    expect(
      await screen.findByText("1500000000000000000 base units"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Unknown token: the wallet has no decimals or symbol for this contract.",
      ),
    ).toBeInTheDocument();
  });

  it("warns that an effectively unlimited approve hands over the whole balance", async () => {
    vi.spyOn(StorageUtil, "getTokenContractsList").mockResolvedValue([
      MQW_TOKEN,
    ]);

    renderSummary(
      call(
        "approve(address,uint256)",
        ["address", "uint256"],
        [SPENDER, MAX_UINT256.toString()],
      ),
    );

    expect(await screen.findByText(UNLIMITED_WARNING)).toBeInTheDocument();
    expect(screen.getByText("Approve token spending")).toBeInTheDocument();
    expect(screen.getByText("Spender")).toBeInTheDocument();
    expect(screen.getByText("Unlimited")).toBeInTheDocument();
  });

  it.each([
    ["2^254", 1n << 254n],
    ["10^40", 10n ** 40n],
  ])(
    "warns for an allowance that dodges a 2^255 rule (%s)",
    async (_label, amount) => {
      vi.spyOn(StorageUtil, "getTokenContractsList").mockResolvedValue([
        MQW_TOKEN,
      ]);

      renderSummary(
        call(
          "approve(address,uint256)",
          ["address", "uint256"],
          [SPENDER, amount.toString()],
        ),
      );

      expect(await screen.findByText(UNLIMITED_WARNING)).toBeInTheDocument();
    },
  );

  it("warns for an allowance above the token's own total supply", async () => {
    vi.spyOn(StorageUtil, "getTokenContractsList").mockResolvedValue([
      MQW_TOKEN,
    ]);

    renderSummary(
      call(
        "approve(address,uint256)",
        ["address", "uint256"],
        // Far below the fixed threshold, far above this token's supply.
        [SPENDER, "2000000000000000000000"],
      ),
      probingStore({ totalSupply: 1000000000000000000000n }),
    );

    expect(await screen.findByText(UNLIMITED_WARNING)).toBeInTheDocument();
  });

  it("does not warn for an allowance inside the token's total supply", async () => {
    vi.spyOn(StorageUtil, "getTokenContractsList").mockResolvedValue([
      MQW_TOKEN,
    ]);

    renderSummary(
      call(
        "approve(address,uint256)",
        ["address", "uint256"],
        [SPENDER, "500000000000000000000"],
      ),
      probingStore({ totalSupply: 1000000000000000000000n }),
    );

    expect(await screen.findByText("Approve token spending")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not warn for a bounded approve", async () => {
    vi.spyOn(StorageUtil, "getTokenContractsList").mockResolvedValue([
      MQW_TOKEN,
    ]);

    renderSummary(
      call("approve(address,uint256)", ["address", "uint256"], [SPENDER, "5"]),
    );

    expect(await screen.findByText("Approve token spending")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reads approve on a known collection as handing over one NFT", async () => {
    vi.spyOn(StorageUtil, "getNFTCollectionsList").mockResolvedValue([
      RELIC_COLLECTION,
    ]);

    renderSummary(
      call("approve(address,uint256)", ["address", "uint256"], [SPENDER, "1"]),
    );

    expect(await screen.findByText("Approve one NFT")).toBeVisible();
    expect(screen.getByText("Token ID")).toBeInTheDocument();
    expect(screen.getByText("Quanta Relics (RELIC)")).toBeInTheDocument();
    expect(screen.queryByText("1 base units")).not.toBeInTheDocument();
  });

  it("never calls an enormous NFT token ID an unlimited allowance", async () => {
    // A QNS name ID is a hash, so it routinely clears any allowance
    // threshold. Approving it hands over one name.
    vi.spyOn(StorageUtil, "getNFTCollectionsList").mockResolvedValue([
      RELIC_COLLECTION,
    ]);

    renderSummary(
      call(
        "approve(address,uint256)",
        ["address", "uint256"],
        [SPENDER, MAX_UINT256.toString()],
      ),
    );

    expect(await screen.findByText("Approve one NFT")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(UNLIMITED_WARNING)).not.toBeInTheDocument();
    expect(screen.getByText(MAX_UINT256.toString())).toBeInTheDocument();
  });

  it("says it cannot tell an amount from a token ID on an unknown contract", async () => {
    renderSummary(
      call("approve(address,uint256)", ["address", "uint256"], [SPENDER, "1"]),
    );

    expect(
      await screen.findByText("Approve an amount or one NFT"),
    ).toBeVisible();
    expect(screen.getByText(APPROVE_CAUTION)).toBeInTheDocument();
    expect(screen.getByText("Amount or token ID")).toBeInTheDocument();
  });

  it("softens the unlimited wording when the contract is unknown", async () => {
    renderSummary(
      call(
        "approve(address,uint256)",
        ["address", "uint256"],
        [SPENDER, MAX_UINT256.toString()],
      ),
    );

    expect(
      await screen.findByText(AMBIGUOUS_UNLIMITED_WARNING),
    ).toBeInTheDocument();
    expect(screen.queryByText(UNLIMITED_WARNING)).not.toBeInTheDocument();
  });

  it("lets the contract probe add caution and nothing else", async () => {
    // A contract decides for itself what supportsInterface returns, so a
    // hybrid token or a maliciously upgraded one can claim to be a
    // collection. The claim may change the note; it may not change the
    // label, the amount, or the warning.
    renderSummary(
      call(
        "approve(address,uint256)",
        ["address", "uint256"],
        [SPENDER, (1n << 200n).toString()],
      ),
      probingStore({ isNft: true }),
    );

    expect(
      await screen.findByText(APPROVE_CAUTION_NFT_REPORTED),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Approve an amount or one NFT"),
    ).toBeInTheDocument();
    expect(screen.getByText("Amount or token ID")).toBeInTheDocument();
    expect(screen.queryByText("Token ID")).not.toBeInTheDocument();
    expect(screen.getByText(AMBIGUOUS_UNLIMITED_WARNING)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("keeps the warning on a hybrid that claims to be a collection", async () => {
    renderSummary(
      call(
        "approve(address,uint256)",
        ["address", "uint256"],
        [SPENDER, (1n << 200n).toString()],
      ),
      probingStore({ isNft: true, totalSupply: 1000n }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Approve one NFT")).not.toBeInTheDocument();
  });

  it("still drops the warning when the user imported the collection", async () => {
    // The user's own list is the only thing that settles it, and it wins
    // over whatever the contract says about itself.
    vi.spyOn(StorageUtil, "getNFTCollectionsList").mockResolvedValue([
      RELIC_COLLECTION,
    ]);

    renderSummary(
      call(
        "approve(address,uint256)",
        ["address", "uint256"],
        [SPENDER, (1n << 200n).toString()],
      ),
      probingStore({ isNft: true }),
    );

    expect(await screen.findByText("Approve one NFT")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the decoded call even while a probe is hanging", async () => {
    const { store: hangingStore, probe } = createProbeStore();
    probe.mockImplementation(() => new Promise(() => {}));

    renderSummary(
      call("approve(address,uint256)", ["address", "uint256"], [SPENDER, "5"]),
      hangingStore,
    );

    expect(
      await screen.findByText("Approve an amount or one NFT"),
    ).toBeVisible();
    expect(screen.getByText(APPROVE_CAUTION)).toBeInTheDocument();
  });

  it("clears a previous contract's probe answers when the request changes", async () => {
    const answers: Partial<Record<string, boolean>> = {
      [CONTRACT]: true,
    };
    const { store, probe } = createProbeStore();
    probe.mockImplementation((transaction) => {
      if (
        typeof transaction.data !== "string" ||
        transaction.data.slice(0, 10) !== "0x01ffc9a7"
      )
        return Promise.resolve("0x");
      const answer = answers[transaction.to];
      if (answer === undefined) return new Promise(() => {});
      return Promise.resolve(word(answer ? 1n : 0n));
    });
    const approveCall = call(
      "approve(address,uint256)",
      ["address", "uint256"],
      [SPENDER, "5"],
    );
    const { rerender } = renderSummary(approveCall, store);

    expect(
      await screen.findByText(APPROVE_CAUTION_NFT_REPORTED),
    ).toBeInTheDocument();

    rerender(
      <StoreProvider value={store}>
        <MemoryRouter>
          <CalldataSummary
            data={approveCall}
            contractAddress={OTHER_CONTRACT}
            fromAddress={OWNER}
          />
        </MemoryRouter>
      </StoreProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText(APPROVE_CAUTION)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(APPROVE_CAUTION_NFT_REPORTED),
    ).not.toBeInTheDocument();
  });

  it("keeps the imported list ahead of the probe", async () => {
    vi.spyOn(StorageUtil, "getTokenContractsList").mockResolvedValue([
      MQW_TOKEN,
    ]);

    renderSummary(
      call("approve(address,uint256)", ["address", "uint256"], [SPENDER, "5"]),
      probingStore({ isNft: true }),
    );

    expect(await screen.findByText("Approve token spending")).toBeVisible();
    expect(screen.getByText("0.000000000000000005 MQW")).toBeInTheDocument();
  });

  it("cautions on transferFrom against an unknown contract", async () => {
    renderSummary(
      call(
        "transferFrom(address,address,uint256)",
        ["address", "address", "uint256"],
        [SOURCE, RECIPIENT, "7"],
      ),
    );

    expect(
      await screen.findByText("Transfer tokens from an address"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "The wallet does not know this contract. If it is a token, the number below is an amount. If it is an NFT collection, it is the ID of the item being moved.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Amount or token ID")).toBeInTheDocument();
  });

  it("does not warn at exactly the fixed threshold", async () => {
    vi.spyOn(StorageUtil, "getTokenContractsList").mockResolvedValue([
      MQW_TOKEN,
    ]);

    renderSummary(
      call(
        "approve(address,uint256)",
        ["address", "uint256"],
        [SPENDER, EFFECTIVELY_UNLIMITED_THRESHOLD.toString()],
      ),
    );

    expect(await screen.findByText("Approve token spending")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("warns that setApprovalForAll hands over the whole collection", async () => {
    renderSummary(
      call(
        "setApprovalForAll(address,bool)",
        ["address", "bool"],
        [SPENDER, true],
      ),
    );

    expect(
      await screen.findByText(
        "This lets the operator move every NFT you hold in this collection, now and in the future.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Approve an operator for a whole collection"),
    ).toBeInTheDocument();
    expect(screen.getByText("Operator")).toBeInTheDocument();
    expect(screen.getByText("Granted")).toBeInTheDocument();
  });

  it("does not warn when setApprovalForAll revokes", async () => {
    renderSummary(
      call(
        "setApprovalForAll(address,bool)",
        ["address", "bool"],
        [SPENDER, false],
      ),
    );

    expect(
      await screen.findByText("Revoke an operator for a whole collection"),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
  });

  it("lists every token ID and quantity of a ZRC-1155 batch transfer", async () => {
    renderSummary(
      call(
        "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
        ["address", "address", "uint256[]", "uint256[]", "bytes"],
        [SOURCE, RECIPIENT, ["1", "2"], ["10", "20"], "0x"],
      ),
    );

    expect(await screen.findByText("Transfer several NFTs")).toBeVisible();
    expect(screen.getByText("1, 2")).toBeInTheDocument();
    expect(screen.getByText("10, 20")).toBeInTheDocument();
    expect(screen.getByText("Taken from")).toBeInTheDocument();
  });

  it("labels an unrecognized selector without claiming to know it", async () => {
    renderSummary(`0xdeadbeef${"00".repeat(64)}`);

    expect(await screen.findByText("Contract interaction")).toBeVisible();
    expect(screen.getByText("0xdeadbeef")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The wallet could not decode this call. Read the raw data before you approve it.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the raw calldata behind a disclosure", async () => {
    const data = call(
      "approve(address,uint256)",
      ["address", "uint256"],
      [SPENDER, "5"],
    );
    renderSummary(data);

    const toggle = await screen.findByRole("button", {
      name: "Show raw data",
    });
    expect(screen.queryByText(data)).not.toBeInTheDocument();

    await userEvent.click(toggle);

    expect(screen.getByText(data)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide raw data" }),
    ).toBeInTheDocument();
  });

  it("shows the address-book name of a known spender", async () => {
    const storeValues = mockedStore({
      contactsStore: {
        contacts: [{ name: "Audited router", address: SPENDER }],
      },
    });

    renderSummary(
      call("approve(address,uint256)", ["address", "uint256"], [SPENDER, "5"]),
      storeValues,
    );

    await waitFor(() =>
      expect(screen.getByText("Audited router")).toBeInTheDocument(),
    );
  });

  it.each([
    { name: "missing params", params: undefined },
    { name: "null params", params: null },
    { name: "empty object", params: {} },
    { name: "empty array", params: [] },
    { name: "null array entry", params: [null] },
    { name: "number array entry", params: [42] },
    { name: "null object entry", params: { 0: null } },
    { name: "number object entry", params: { 0: 42 } },
    { name: "string params", params: "invalid" },
  ])("refuses $name with the real approval content", async ({ params }) => {
    const setCanProceed = vi.fn();
    const setOnPermissionCallBack =
      vi.fn<DAppRequestStore["setOnPermissionCallBack"]>();
    const getMnemonicPhrases = vi.fn().mockResolvedValue("");
    const addTransaction = vi.fn().mockResolvedValue(undefined);
    const store = mockedStore({
      dAppRequestStore: {
        dAppRequestData: { method: "qrl_sendTransaction", params },
        setCanProceed,
        setOnPermissionCallBack,
      },
      lockStore: { getMnemonicPhrases },
      transactionHistoryStore: { addTransaction },
    });
    render(
      <StoreProvider value={store}>
        <MemoryRouter>
          <TooltipProvider>
            <QrlSendTransaction />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );
    expect(screen.getByText("Review this request")).toBeInTheDocument();
    expect(setCanProceed).toHaveBeenLastCalledWith(false);

    const callback = setOnPermissionCallBack.mock.lastCall?.[0];
    if (!callback) throw new Error("Missing approval callback");
    const record = vi.fn<ResponseRecorder>();
    await act(async () => {
      await callback(true, record);
    });

    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.lastCall?.[0].error).toMatchObject({ code: -32602 });
    expect(getMnemonicPhrases).not.toHaveBeenCalled();
    expect(addTransaction).not.toHaveBeenCalled();
  });

  it.each(["array", "object"])(
    "preserves transfer metadata through the real approval content for %s params",
    async (format) => {
      vi.spyOn(StorageUtil, "getDAppsConnectedAccountsData").mockResolvedValue({
        urlOrigin: "https://request.example",
        accounts: [OWNER],
        blockchains: [DEFAULT_BLOCKCHAIN],
        permissions: [],
      });
      vi.spyOn(StorageUtil, "getActiveBlockChain").mockResolvedValue(
        DEFAULT_BLOCKCHAIN,
      );
      const transaction = {
        from: OWNER,
        to: RECIPIENT,
        value: "0xde0b6b3a7640000",
        gas: "0x5208",
        type: "0x2",
      };
      const request = {
        method: "qrl_sendTransaction",
        requestId: "transfer-metadata-test",
        authorizedChainId: DEFAULT_BLOCKCHAIN.chainId,
        requestData: { senderData: { url: "https://request.example" } },
        params: format === "array" ? [transaction] : { 0: transaction },
      };
      const authorization = await revalidateAuthorizedDAppRequest(request);
      expect(authorization.canProceed).toBe(true);

      const setOnPermissionCallBack =
        vi.fn<DAppRequestStore["setOnPermissionCallBack"]>();
      const setCanProceed = vi.fn();
      const addTransaction = vi.fn().mockResolvedValue(undefined);
      const signTransaction = vi.fn().mockResolvedValue({
        rawTransaction: "0xdeadbeef",
        transactionHash: "0xprecomputed",
      });
      const send = vi.fn().mockResolvedValue("0xbroadcast");
      const store = mockedStore({
        dAppRequestStore: {
          dAppRequestData: request,
          setCanProceed,
          setOnPermissionCallBack,
        },
        qrlStore: {
          getGasFeeData: vi.fn().mockResolvedValue({
            baseFeePerGas: 100n,
            maxFeePerGas: 200n,
            maxPriorityFeePerGas: 10n,
          }),
          qrlInstance: {
            accounts: {
              seedToAccount: vi.fn().mockReturnValue({ address: OWNER }),
              signTransaction,
            },
            getGasPrice: vi.fn().mockResolvedValue(100n),
            getTransactionCount: vi.fn().mockResolvedValue(3n),
            estimateGas: vi.fn().mockResolvedValue(21000n),
            call: vi.fn().mockResolvedValue("0x"),
            requestManager: { send },
          },
        },
        transactionHistoryStore: { addTransaction },
      });
      const { rerender } = render(
        <StoreProvider value={store}>
          <MemoryRouter>
            <TooltipProvider>
              <QrlSendTransaction />
            </TooltipProvider>
          </MemoryRouter>
        </StoreProvider>,
      );
      await waitFor(() => {
        expect(setCanProceed).toHaveBeenLastCalledWith(true);
      });
      const callback = setOnPermissionCallBack.mock.lastCall?.[0];
      if (!callback) throw new Error("Missing approval callback");
      const record = vi.fn();
      await act(async () => {
        await callback(true, record);
      });

      expect(signTransaction).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          from: OWNER,
          to: RECIPIENT,
          value: transaction.value,
          gas: transaction.gas,
          nonce: 3n,
          maxFeePerGas: "0xd2",
          maxPriorityFeePerGas: 10n,
        }),
        "synthetic-test-seed",
      );
      expect(send).toHaveBeenCalledExactlyOnceWith({
        method: "qrl_sendRawTransaction",
        params: ["0xdeadbeef"],
      });
      expect(record).toHaveBeenCalledExactlyOnceWith({
        transactionHash: "0xbroadcast",
      });
      expect(addTransaction).toHaveBeenCalledExactlyOnceWith(
        OWNER,
        expect.objectContaining({
          to: RECIPIENT,
          transactionHash: "0xbroadcast",
          amount: "1",
          nonce: 3,
          gasLimit: 21000,
          maxFeePerGas: "210",
          maxPriorityFeePerGas: "10",
        }),
      );

      const invalidStore = mockedStore({
        dAppRequestStore: {
          dAppRequestData: { ...request, params: null },
          setCanProceed,
          setOnPermissionCallBack,
        },
        transactionHistoryStore: { addTransaction },
      });
      rerender(
        <StoreProvider value={invalidStore}>
          <MemoryRouter>
            <TooltipProvider>
              <QrlSendTransaction />
            </TooltipProvider>
          </MemoryRouter>
        </StoreProvider>,
      );
      expect(screen.getByText("Review this request")).toBeInTheDocument();
      expect(screen.queryByText("1 Quanta")).not.toBeInTheDocument();
      expect(setCanProceed).toHaveBeenLastCalledWith(false);

      const invalidCallback = setOnPermissionCallBack.mock.lastCall?.[0];
      if (!invalidCallback) throw new Error("Missing approval callback");
      const invalidRecord = vi.fn<ResponseRecorder>();
      await act(async () => {
        await invalidCallback(true, invalidRecord);
      });
      expect(invalidRecord).toHaveBeenCalledOnce();
      expect(invalidRecord.mock.lastCall?.[0].error).toMatchObject({
        code: -32602,
      });
      expect(signTransaction).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledOnce();
      expect(addTransaction).toHaveBeenCalledOnce();
    },
  );
});
