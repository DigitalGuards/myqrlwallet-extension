import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import { MAX_UINT256 } from "@/functions/decodeTransactionCalldata";
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
      { address: CONTRACT, symbol: "MQW", decimals: 18, image: "" },
    ]);

    renderSummary(
      call(
        "approve(address,uint256)",
        ["address", "uint256"],
        [SPENDER, MAX_UINT256.toString()],
      ),
    );

    expect(
      await screen.findByText(
        "This grants unlimited spending of this token. The spender can move your whole balance at any time, now and in the future.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Approve token spending")).toBeInTheDocument();
    expect(screen.getByText("Spender")).toBeInTheDocument();
    expect(screen.getByText("Unlimited")).toBeInTheDocument();
  });

  it("does not warn for a bounded approve", async () => {
    renderSummary(
      call("approve(address,uint256)", ["address", "uint256"], [SPENDER, "5"]),
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
