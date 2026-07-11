import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOnChainHistory, ON_CHAIN_PAGE_SIZE } from "./onChainHistory";

const ADDRESS = "Q6153d37Fa4DA7193E6219DCBd2bBe62Fa12905b1";
const CHAIN = "0x539";

// One realistic row from the live zondscan aggregate endpoint.
const sampleRow = {
  ID: "6a4fb2f5158873a9b316331a",
  InOut: 0,
  TxType: "0x2",
  Address: "Qc1b1df9180b798534a67816da90f072e976bb4e4",
  From: "Q6153d37fa4da7193e6219dcbd2bbe62fa12905b1",
  To: "Qc1b1df9180b798534a67816da90f072e976bb4e4",
  TxHash: "0xa0ac2873d4d76142bc4619473a9a639f1ce8e73ccd08ad2c0cbf175ce331bcc6",
  TimeStamp: "0x6a4fb2e4",
  Amount: "750.000000000000000000",
  PaidFees: "0.000052500000147000",
  BlockNumber: "143412",
};

// One realistic internal-transaction row (QuantaSwap HTLC claim payout)
// from the live aggregate endpoint after zondscan #162.
const sampleInternalRow = {
  Type: "CALL",
  CallType: "call",
  Hash: "0x421b1d9d4c41a6f1d699621dbd4980c78386a51910853f9f90d10ffcb710d8da",
  From: "Q94cd8e406d2bb4ea251dce3f0558941f2ac056ee",
  To: "Q79b662ce3d663643df4454a8ba3f532c0de6887f",
  Input: "0x",
  Output: "0x",
  TraceAddress: [1],
  Value: 43.05396,
  Gas: "0x5fc7",
  GasUsed: "0x0",
  AddressFunctionIdentifier: "",
  AmountFunctionIdentifier: "0x0",
  BlockTimestamp: "0x6a5275c4",
};

const mockFetch = vi.fn<any>();

const okResponse = (body: unknown) => ({
  ok: true,
  json: async () => body,
});

describe("fetchOnChainHistory", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps explorer rows onto history entries", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        transactions_by_address: [sampleRow],
        transactions_count: 82,
      }),
    );

    const page = await fetchOnChainHistory(ADDRESS, CHAIN, 1);

    expect(mockFetch).toHaveBeenCalledWith(
      `https://zondscan.com/api/address/aggregate/${ADDRESS}?page=1&limit=${ON_CHAIN_PAGE_SIZE}`,
    );
    expect(page.totalCount).toBe(82);
    expect(page.entries).toHaveLength(1);
    const entry = page.entries[0];
    expect(entry.transactionHash).toBe(sampleRow.TxHash);
    expect(entry.id).toBe(sampleRow.TxHash);
    expect(entry.from).toBe(sampleRow.From);
    expect(entry.to).toBe(sampleRow.To);
    expect(entry.amount).toBe(750);
    expect(entry.timestamp).toBe(parseInt("0x6a4fb2e4", 16) * 1000);
    expect(entry.paidFeesQrl).toBe(sampleRow.PaidFees);
    expect(entry.blockNumber).toBe("143412");
    expect(entry.status).toBe(true);
    expect(entry.isZrc20Token).toBe(false);
    expect(entry.tokenContractAddress).toBe("");
    expect(entry.tokenSymbol).toBe("QRL");
    expect(entry.gasUsed).toBe("");
    expect(entry.effectiveGasPrice).toBe("");
    expect(entry.chainId).toBe(CHAIN);
  });

  it("maps internal transactions onto distinct incoming entries", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        transactions_by_address: [sampleRow],
        transactions_count: 82,
        internal_transactions_by_address: [sampleInternalRow],
        internal_transactions_count: 1,
      }),
    );

    const page = await fetchOnChainHistory(ADDRESS, CHAIN, 1);

    expect(page.entries).toHaveLength(2);
    const internal = page.entries[1];
    expect(internal.isInternal).toBe(true);
    expect(internal.transactionHash).toBe(sampleInternalRow.Hash);
    // Unique id so it survives dedup against the outer tx with the same hash.
    expect(internal.id).toBe(`${sampleInternalRow.Hash}-internal-1`);
    expect(internal.from).toBe(sampleInternalRow.From);
    expect(internal.to).toBe(sampleInternalRow.To);
    expect(internal.amount).toBe(43.05396);
    expect(internal.timestamp).toBe(parseInt("0x6a5275c4", 16) * 1000);
    expect(internal.paidFeesQrl).toBe("0");
    expect(internal.tokenSymbol).toBe("QRL");
    expect(internal.status).toBe(true);
  });

  it("drives pagination with the larger of the two counts", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        transactions_by_address: [sampleRow],
        transactions_count: 3,
        internal_transactions_by_address: [sampleInternalRow],
        internal_transactions_count: 40,
      }),
    );

    const page = await fetchOnChainHistory(ADDRESS, CHAIN, 1);
    expect(page.totalCount).toBe(40);
  });

  it("tolerates a null internal transaction list (Go nil slice)", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        transactions_by_address: [sampleRow],
        transactions_count: 1,
        internal_transactions_by_address: null,
        internal_transactions_count: 0,
      }),
    );

    const page = await fetchOnChainHistory(ADDRESS, CHAIN, 1);
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].isInternal).toBeUndefined();
  });

  it("skips rows without a transaction hash", async () => {
    mockFetch.mockResolvedValue(
      okResponse({
        transactions_by_address: [sampleRow, { ...sampleRow, TxHash: "" }],
        transactions_count: 2,
      }),
    );

    const page = await fetchOnChainHistory(ADDRESS, CHAIN, 1);
    expect(page.entries).toHaveLength(1);
  });

  it("tolerates a null transaction list (Go nil slice)", async () => {
    mockFetch.mockResolvedValue(
      okResponse({ transactions_by_address: null, transactions_count: 0 }),
    );

    const page = await fetchOnChainHistory(ADDRESS, CHAIN, 1);
    expect(page).toEqual({ entries: [], totalCount: 0 });
  });

  it("returns an empty page for chains without an explorer", async () => {
    const page = await fetchOnChainHistory(ADDRESS, "0x1", 1);
    expect(page).toEqual({ entries: [], totalCount: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns an empty page on HTTP errors and network failures", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    expect(await fetchOnChainHistory(ADDRESS, CHAIN, 1)).toEqual({
      entries: [],
      totalCount: 0,
    });

    mockFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchOnChainHistory(ADDRESS, CHAIN, 1)).toEqual({
      entries: [],
      totalCount: 0,
    });
  });
});
