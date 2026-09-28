import { afterEach, describe, expect, it, vi } from "vitest";
import { RESTRICTED_METHODS } from "../constants/requestConstants";
import {
  buildDAppSendTransactionErrorData,
  extractPendingDAppTransactionHash,
  registerDAppTransactionWatchIfApproved,
} from "./restrictedMethodsMiddlewareUtils";

const { mockRegisterWatch } = vi.hoisted(() => ({
  mockRegisterWatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./dAppTransactionWatcher", () => ({
  registerDAppTransactionWatch: mockRegisterWatch,
}));

const ACCOUNT = `Q${"a".repeat(128)}`;
const ORIGIN = "https://audit-dapp.example";

const sendTransactionRequest = (from: unknown) =>
  ({
    id: 1,
    jsonrpc: "2.0",
    method: RESTRICTED_METHODS.QRL_SEND_TRANSACTION,
    params: [{ from }],
    senderData: { url: `${ORIGIN}/request` },
  }) as never;

describe("registerDAppTransactionWatchIfApproved", () => {
  it("registers a watch for the tx sender and the authorized chain", async () => {
    await registerDAppTransactionWatchIfApproved(
      sendTransactionRequest(ACCOUNT),
      "0xtxhash",
      "0x301825",
    );

    expect(mockRegisterWatch).toHaveBeenCalledWith({
      hash: "0xtxhash",
      account: ACCOUNT,
      chainId: "0x301825",
    });
  });

  it("falls back to the pinned v3 chain id when none was authorized", async () => {
    await registerDAppTransactionWatchIfApproved(
      sendTransactionRequest(ACCOUNT),
      "0xtxhash",
      undefined,
    );

    expect(mockRegisterWatch).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: "0x301825" }),
    );
  });

  it.each([undefined, null, "", 12345])(
    "does nothing for a non-string or empty transactionHash (%s)",
    async (transactionHash) => {
      await registerDAppTransactionWatchIfApproved(
        sendTransactionRequest(ACCOUNT),
        transactionHash,
        "0x301825",
      );

      expect(mockRegisterWatch).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "", 12345])(
    "does nothing when the request carries no usable sender (%s)",
    async (from) => {
      await registerDAppTransactionWatchIfApproved(
        sendTransactionRequest(from),
        "0xtxhash",
        "0x301825",
      );

      expect(mockRegisterWatch).not.toHaveBeenCalled();
    },
  );

  describe("exception safety", () => {
    afterEach(() => {
      mockRegisterWatch.mockReset().mockResolvedValue(undefined);
    });

    // F4: called from restrictedMethodsMiddleware's `finally`, where a
    // throw would stop `end()` from running and void an otherwise
    // successful response.
    it("does not throw, and only logs, when registerDAppTransactionWatch rejects", async () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockRegisterWatch.mockRejectedValue(new Error("storage unavailable"));

      await expect(
        registerDAppTransactionWatchIfApproved(
          sendTransactionRequest(ACCOUNT),
          "0xtxhash",
          "0x301825",
        ),
      ).resolves.toBeUndefined();

      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });
});

describe("extractPendingDAppTransactionHash", () => {
  it("reads the hash a TransactionMayStillBeProcessingError carries under error.data", () => {
    expect(
      extractPendingDAppTransactionHash({
        error: {
          message: "may still be processing",
          data: { transactionHash: "0xpending" },
        },
      }),
    ).toBe("0xpending");
  });

  it.each([
    [
      "a response with a plain result and no error",
      { transactionHash: "0xtxhash" },
    ],
    [
      "a response with an error but no data",
      { error: { message: "rejected" } },
    ],
    [
      "a response whose error.data has no transactionHash",
      { error: { data: { pending: true } } },
    ],
    [
      "a response whose error.data.transactionHash is not a string",
      { error: { data: { transactionHash: 12345 } } },
    ],
    ["undefined", undefined],
    ["null", null],
  ])("returns undefined for %s", (_label, response) => {
    expect(extractPendingDAppTransactionHash(response)).toBeUndefined();
  });
});

describe("buildDAppSendTransactionErrorData", () => {
  // N2: the dApp-visible shape after sanitizeError (scriptUtils.ts) already
  // ran once in the approval surface's document. That is what
  // `response.error` looks like by the time the middleware sees it: a
  // TransactionMayStillBeProcessingError sanitizes to
  // `{ message, data: { transactionHash, pending } }`.
  it("hoists the transaction hash to the top level for a may-still-be-processing error", () => {
    const response = {
      error: {
        message: "The transaction was not confirmed within the wait time.",
        data: { transactionHash: "0xpending", pending: true },
      },
    };

    expect(buildDAppSendTransactionErrorData(response)).toEqual({
      message: "The transaction was not confirmed within the wait time.",
      // Backwards-compatible: the original nested shape is kept alongside
      // the hoisted field.
      data: { transactionHash: "0xpending", pending: true },
      transactionHash: "0xpending",
    });
  });

  it("has no top-level transactionHash for an error that never had one (a node rejection)", () => {
    const response = {
      error: { message: "insufficient funds for gas * price + value" },
    };

    expect(buildDAppSendTransactionErrorData(response)).toEqual({
      message: "insufficient funds for gas * price + value",
    });
  });

  it.each([
    ["no error at all", { transactionHash: "0xtxhash" }],
    ["undefined", undefined],
    ["null", null],
  ])("returns an empty object for %s", (_label, response) => {
    expect(buildDAppSendTransactionErrorData(response)).toEqual({});
  });
});
