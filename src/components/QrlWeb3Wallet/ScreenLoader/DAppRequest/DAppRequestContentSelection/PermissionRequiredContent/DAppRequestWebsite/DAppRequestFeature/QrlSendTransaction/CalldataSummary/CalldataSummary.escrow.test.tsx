import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import { SWAP_VECTORS as V } from "@/functions/swapEscrowVectors";
import {
  encodeFunctionSignature,
  encodeParameters,
} from "@theqrl/web3-qrl-abi";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalldataSummary from "./CalldataSummary";

const CONTRACT = `Q${"12".repeat(64)}`;
const OWNER = `Q${"34".repeat(64)}`;

// The vectors carry the refund time 1790000000 (a Unix second count).
const TIMEOUT_S = 1790000000;
const HONESTY =
  "The wallet read this from the transaction data by matching the function signature. It has not verified the contract at this address, and another contract can use the same function names.";

const call = (signature: string, types: string[], values: unknown[]) =>
  `${encodeFunctionSignature(signature)}${encodeParameters(types, values).slice(2)}`;

const renderSummary = (data: string) =>
  render(
    <StoreProvider value={mockedStore()}>
      <MemoryRouter>
        <CalldataSummary
          data={data}
          contractAddress={CONTRACT}
          fromAddress={OWNER}
        />
      </MemoryRouter>
    </StoreProvider>,
  );

const setNow = (seconds: number) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(seconds * 1000);
};

describe("CalldataSummary swap escrow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(StorageUtil, "getTokenContractsList").mockResolvedValue([]);
    vi.spyOn(StorageUtil, "getNFTCollectionsList").mockResolvedValue([]);
    setNow(TIMEOUT_S - 3600);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("explains lockNative with the recipient, refund time and swap ID", async () => {
    renderSummary(V.lockNative);

    expect(
      await screen.findByText("Lock funds in a swap escrow"),
    ).toBeInTheDocument();
    expect(screen.getByText("Locked for")).toBeInTheDocument();
    expect(screen.getByText("Refundable after")).toBeInTheDocument();
    expect(
      screen.getByText(new Date(TIMEOUT_S * 1000).toLocaleString()),
    ).toBeInTheDocument();
    expect(screen.getByText("Swap ID (hashlock)")).toBeInTheDocument();
    expect(screen.getByTitle(V.H)).toHaveTextContent("0x1122334455...ccddeeff");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Contract interaction")).not.toBeInTheDocument();
    expect(screen.getByText(HONESTY)).toBeInTheDocument();
  });

  it("keeps the raw data disclosure", async () => {
    renderSummary(V.lockNative);
    await userEvent.click(
      await screen.findByRole("button", { name: "Show raw data" }),
    );
    expect(screen.getByText(V.lockNative)).toBeInTheDocument();
  });

  it("warns when the refund time has passed", async () => {
    setNow(TIMEOUT_S + 10);
    renderSummary(V.lockNative);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already passed",
    );
  });

  it("warns when the refund time is more than 30 days ahead", async () => {
    setNow(TIMEOUT_S - 31 * 24 * 3600);
    renderSummary(V.lockNative);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "more than 30 days away",
    );
  });

  it("shows an unrepresentable time as raw seconds with a warning", async () => {
    renderSummary(
      call(
        "lockNativeOpen(bytes32,uint256)",
        ["bytes32", "uint256"],
        [V.H, 10n ** 20n],
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("30 days");
    expect(screen.getByText("100000000000000000000")).toBeInTheDocument();
  });

  it("says no recipient is fixed for lockTokenOpen and uses the imported token", async () => {
    vi.spyOn(StorageUtil, "getTokenContractsList").mockResolvedValue([
      { address: V.T, symbol: "MQW", decimals: 18, image: "" },
    ]);
    renderSummary(
      call(
        "lockTokenOpen(bytes32,address,uint256,uint256)",
        ["bytes32", "address", "uint256", "uint256"],
        [V.H, V.T, "2500000000000000000", TIMEOUT_S],
      ),
    );
    expect(
      await screen.findByText(
        "Lock tokens in a swap escrow with no recipient yet",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No recipient is fixed yet. It can be set later."),
    ).toBeInTheDocument();
    expect(await screen.findByText("2.5 MQW")).toBeInTheDocument();
    expect(screen.getByText(HONESTY)).toBeInTheDocument();
  });

  it("shows base units for an unknown token in lockToken", async () => {
    renderSummary(
      call(
        "lockToken(bytes32,address,address,uint256,uint256)",
        ["bytes32", "address", "address", "uint256", "uint256"],
        [V.H, V.B, V.T, 42n, TIMEOUT_S],
      ),
    );
    expect(await screen.findByText("42 base units")).toBeInTheDocument();
    expect(screen.getByText(/Unknown token/)).toBeInTheDocument();
  });

  it("says claim reveals the swap secret on chain", async () => {
    renderSummary(V.claim);
    expect(
      await screen.findByText("Claim funds from a swap escrow"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/reveals the swap secret on chain/),
    ).toBeInTheDocument();
    expect(screen.getByTitle(V.P)).toBeInTheDocument();
    expect(screen.getByText(HONESTY)).toBeInTheDocument();
  });

  it("says refund returns funds to the locker", async () => {
    renderSummary(V.refund);
    expect(
      await screen.findByText(
        "The funds return to the address that locked them.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the destination of a parked payout withdrawal", async () => {
    renderSummary(V.withdraw);
    expect(
      await screen.findByText("Collect a parked payout"),
    ).toBeInTheDocument();
    expect(screen.getByText("Payout goes to")).toBeInTheDocument();
    expect(await screen.findByText(/base units/)).toBeInTheDocument();
  });

  it("names the native coin for a zero token word", async () => {
    renderSummary(V.withdrawNative);
    expect(await screen.findByText("Quanta")).toBeInTheDocument();
  });

  it("falls back to the unknown view for malformed escrow calldata", async () => {
    renderSummary(`${V.lockNative}00`);
    expect(await screen.findByText("Contract interaction")).toBeInTheDocument();
    expect(screen.queryByText(HONESTY)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Function selector")).toBeInTheDocument();
    });
  });
});
