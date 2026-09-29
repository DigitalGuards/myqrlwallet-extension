import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalldataSummary from "./CalldataSummary";

const SPENDER = `Q${"ab".repeat(64)}`;
const RECIPIENT = `Q${"cd".repeat(64)}`;
const SOURCE = `Q${"ef".repeat(64)}`;
const CONTRACT = `Q${"12".repeat(64)}`;
const OWNER = `Q${"34".repeat(64)}`;

const call = (signature: string, types: string[], values: unknown[]) =>
  `${encodeFunctionSignature(signature)}${encodeParameters(types, values).slice(2)}`;

const UNLIMITED_WARNING =
  "This allows spending more than the token's entire supply. It is effectively unlimited: the spender can move your whole balance at any time, now and in the future.";
const AMBIGUOUS_UNLIMITED_WARNING =
  "If this contract is a token, this allows spending more than its entire supply and is effectively unlimited. If it is an NFT collection, the number below is a token ID.";
const APPROVE_CAUTION =
  "The wallet does not know this contract. If it is a token, the number below is an amount. If it is an NFT collection, it is the ID of one item, and approving hands that exact item to the spender.";

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
const probingStore = ({
  isNft,
  totalSupply,
}: {
  isNft?: boolean;
  totalSupply?: bigint;
} = {}) =>
  mockedStore({
    qrlStore: {
      qrlInstance: {
        call: async (transaction: { data?: string }) => {
          const selector = transaction.data?.slice(0, 10);
          if (selector === "0x01ffc9a7") {
            return isNft === undefined ? "0x" : word(isNft ? 1n : 0n);
          }
          if (selector === "0x18160ddd") {
            return totalSupply === undefined ? "0x" : word(totalSupply);
          }
          return "0x";
        },
      } as any,
    },
  });

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

  it("uses the contract probe when neither list knows the contract", async () => {
    renderSummary(
      call(
        "approve(address,uint256)",
        ["address", "uint256"],
        [SPENDER, MAX_UINT256.toString()],
      ),
      probingStore({ isNft: true }),
    );

    expect(await screen.findByText("Approve one NFT")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Token ID")).toBeInTheDocument();
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
});
