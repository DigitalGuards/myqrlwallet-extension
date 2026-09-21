import { describe, expect, it } from "vitest";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import { needsReceipt, transactionFailureUpdate } from "./transactionOutcome";

describe("receipt evidence", () => {
  it.each([
    new Error("timeout"),
    new Error("RPC unavailable"),
    { code: -32000, message: "unknown" },
  ])("keeps ambiguous observation errors reconcilable", (error) => {
    const update = transactionFailureUpdate(error, "0xabc");
    expect(update).toEqual({ pendingStatus: "unknown", status: false });
    expect(needsReceipt(update as TransactionHistoryEntry)).toBe(true);
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
    expect(needsReceipt(update as TransactionHistoryEntry)).toBe(false);
  });

  it.each([0n, 0, false, "0x0"])(
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
      expect(needsReceipt(update as TransactionHistoryEntry)).toBe(false);
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
        pendingStatus: "failed",
        blockNumber: "",
      } as TransactionHistoryEntry),
    ).toBe(true);
    expect(
      needsReceipt({
        pendingStatus: "failed",
        blockNumber: "10",
      } as TransactionHistoryEntry),
    ).toBe(false);
  });
});
