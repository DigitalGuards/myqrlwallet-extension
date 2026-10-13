import { describe, expect, it } from "vitest";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import { needsReceipt, transactionFailureUpdate } from "./transactionOutcome";

const historyEntry: TransactionHistoryEntry = {
  id: "entry",
  from: "sender",
  to: "recipient",
  amount: "1",
  tokenSymbol: "QRL",
  tokenName: "Quantum Resistant Ledger",
  isZrc20Token: false,
  tokenContractAddress: "",
  tokenDecimals: 18,
  transactionHash: "0xabc",
  blockNumber: "",
  gasUsed: "",
  effectiveGasPrice: "",
  status: false,
  timestamp: 1,
  chainId: "1",
};

describe("receipt evidence", () => {
  it.each([
    new Error("timeout"),
    new Error("RPC unavailable"),
    { code: -32000, message: "unknown" },
  ])("keeps ambiguous observation errors reconcilable", (error) => {
    const update = transactionFailureUpdate(error, "0xabc");
    expect(update).toEqual({ pendingStatus: "unknown", status: false });
    expect(needsReceipt({ ...historyEntry, ...update })).toBe(true);
  });

  it("distinguishes explicit request rejection", () => {
    const update = transactionFailureUpdate(
      { innerError: { code: -32602 } },
      "0xabc",
    );
    expect(update).toEqual({
      pendingStatus: "failed",
      status: false,
      submissionRejected: true,
    });
    expect(needsReceipt({ ...historyEntry, ...update })).toBe(false);
  });

  it.each([0n, 0, false, "0x0", "0", "false"])(
    "records a matching reverted receipt with status %s",
    (status) => {
      const update = transactionFailureUpdate(
        { receipt: { transactionHash: "0xABC", status, blockNumber: 10n } },
        "0xabc",
      );
      expect(update).toMatchObject({
        pendingStatus: "failed",
        status: false,
        blockNumber: "10",
        receiptStatusVerified: true,
      });
      expect(needsReceipt({ ...historyEntry, ...update })).toBe(false);
    },
  );

  it.each([undefined, null, "unexpected", 2, "1oops"])(
    "retains unknown status %s without asserting execution",
    (status) => {
      expect(
        transactionFailureUpdate(
          { receipt: { transactionHash: "0xabc", status, blockNumber: 10n } },
          "0xabc",
        ),
      ).toEqual({ pendingStatus: "unknown", status: false });
    },
  );

  it("requires the receipt to identify the submitted transaction", () => {
    expect(
      transactionFailureUpdate(
        {
          receipt: { transactionHash: "0xother", status: 1n, blockNumber: 10n },
        },
        "0xabc",
      ),
    ).toEqual({ pendingStatus: "unknown", status: false });
  });

  it("supports byte-array receipt hashes", () => {
    expect(
      transactionFailureUpdate(
        {
          receipt: {
            transactionHash: new Uint8Array([171]),
            status: 1n,
            blockNumber: 10n,
          },
        },
        "0xab",
      ),
    ).toMatchObject({
      pendingStatus: "confirmed",
      receiptStatusVerified: true,
    });
  });

  it("revisits legacy failures lacking execution or rejection evidence", () => {
    expect(
      needsReceipt({
        ...historyEntry,
        pendingStatus: "failed",
        blockNumber: "",
      }),
    ).toBe(true);
    expect(
      needsReceipt({
        ...historyEntry,
        pendingStatus: "failed",
        blockNumber: "10",
      }),
    ).toBe(false);
  });

  it.each([1n, 1, true, "0x1", "1", "true"])(
    "preserves successful receipt status %s and fee quantities",
    (status) => {
      expect(
        transactionFailureUpdate(
          {
            receipt: {
              transactionHash: "0xabc",
              status,
              blockNumber: "0xa",
              gasUsed: 21000n,
              effectiveGasPrice: 100,
            },
          },
          "0xabc",
        ),
      ).toEqual({
        pendingStatus: "confirmed",
        status: true,
        receiptStatusVerified: true,
        blockNumber: "0xa",
        gasUsed: "21000",
        effectiveGasPrice: "100",
      });
    },
  );

  it.each(["status", "blockNumber", "gasUsed", "effectiveGasPrice"])(
    "keeps malformed %s reconcilable without coercing objects",
    (field) => {
      for (const value of [null, undefined, {}, [1], { toString: () => "1" }]) {
        expect(
          transactionFailureUpdate(
            {
              receipt: {
                transactionHash: "0xabc",
                status: 1n,
                blockNumber: 10n,
                [field]: value,
              },
            },
            "0xabc",
          ),
        ).toEqual({ pendingStatus: "unknown", status: false });
      }
    },
  );

  it.each([-32600, -32601, -32602, -32003, "-32602"])(
    "preserves explicit request rejection code %s",
    (code) => {
      expect(transactionFailureUpdate({ code }, "0xabc")).toEqual({
        pendingStatus: "failed",
        status: false,
        submissionRejected: true,
      });
    },
  );

  it.each([
    { code: [-32602] },
    { code: { valueOf: (): number => -32602 } },
    { code: null },
    { code: undefined },
  ])("keeps a malformed rejection code reconcilable: $code", ({ code }) => {
    expect(transactionFailureUpdate({ code }, "0xabc")).toEqual({
      pendingStatus: "unknown",
      status: false,
    });
  });
});
