import { describe, expect, it, vi } from "vitest";
import { RESTRICTED_METHODS } from "../constants/requestConstants";
import { registerDAppTransactionWatchIfApproved } from "./restrictedMethodsMiddlewareUtils";

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
});
