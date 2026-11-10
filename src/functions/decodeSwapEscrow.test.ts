import { describe, expect, it } from "vitest";
import {
  encodeFunctionSignature,
  encodeParameters,
} from "@theqrl/web3-qrl-abi";
import {
  SWAP_ESCROW_ACTIONS,
  decodeTransactionCalldata,
  knownCalldataSelectors,
} from "./decodeTransactionCalldata";
import { SWAP_VECTORS as V } from "./swapEscrowVectors";

const call = (signature: string, types: string[], values: unknown[]) =>
  `${encodeFunctionSignature(signature)}${encodeParameters(types, values).slice(2)}`;

const lower = (value: string) => value.toLowerCase();
const same = (a: string | undefined, b: string) => {
  expect(lower(a ?? "")).toBe(lower(b));
};

describe("decodeTransactionCalldata swap escrow", () => {
  it("decodes the lockNative vector from the QuantaSwap encoder", () => {
    const decoded = decodeTransactionCalldata(V.lockNative);
    expect(decoded.status).toBe("swapEscrow");
    if (decoded.status !== "swapEscrow") return;
    expect(decoded.action).toBe(SWAP_ESCROW_ACTIONS.LOCK_NATIVE);
    expect(decoded.selector).toBe("0xad4c2381");
    expect(decoded.hashlock).toBe(V.H);
    same(decoded.recipient, V.B);
    expect(decoded.timeoutS).toBe(1790000000n);
  });

  it("agrees with the wallet's own ABI coder on bytes32 layout", () => {
    expect(
      call(
        "lockNative(bytes32,address,uint256)",
        ["bytes32", "address", "uint256"],
        [V.H, V.B, 1790000000n],
      ).toLowerCase(),
    ).toBe(V.lockNative);
  });

  it("decodes the claim vector and exposes the preimage", () => {
    const decoded = decodeTransactionCalldata(V.claim);
    expect(decoded.status).toBe("swapEscrow");
    if (decoded.status !== "swapEscrow") return;
    expect(decoded.action).toBe("claim");
    expect(decoded.hashlock).toBe(V.H);
    expect(decoded.preimage).toBe(V.P);
  });

  it("decodes lockNativeOpen, assign, release and refund", () => {
    const open = decodeTransactionCalldata(V.lockNativeOpen);
    expect(open).toMatchObject({
      status: "swapEscrow",
      action: "lockNativeOpen",
      hashlock: V.H,
      timeoutS: 1790000000n,
    });
    if (open.status === "swapEscrow") expect(open.recipient).toBeUndefined();

    const assign = decodeTransactionCalldata(V.assign);
    expect(assign).toMatchObject({ action: "assign", hashlock: V.H });
    if (assign.status === "swapEscrow") same(assign.recipient, V.B);

    expect(decodeTransactionCalldata(V.release)).toMatchObject({
      action: "release",
      hashlock: V.H,
    });
    expect(decodeTransactionCalldata(V.refund)).toMatchObject({
      action: "refund",
      hashlock: V.H,
    });
  });

  it("decodes withdraw, withdrawAll and pushCredit", () => {
    const withdraw = decodeTransactionCalldata(V.withdraw);
    expect(withdraw).toMatchObject({
      action: "withdraw",
      amount: 5000000000000000000n,
    });
    if (withdraw.status === "swapEscrow") {
      same(withdraw.token, V.T);
      same(withdraw.to, V.B);
    }
    const all = decodeTransactionCalldata(V.withdrawAll);
    expect(all).toMatchObject({ action: "withdrawAll" });
    if (all.status === "swapEscrow") same(all.to, V.B);
    const push = decodeTransactionCalldata(V.pushCredit);
    expect(push).toMatchObject({ action: "pushCredit" });
    if (push.status === "swapEscrow") {
      same(push.token, V.T);
      same(push.account, V.A);
    }
  });

  it("reads the all-zero token word as the native coin", () => {
    const decoded = decodeTransactionCalldata(V.withdrawNative);
    expect(decoded).toMatchObject({
      status: "swapEscrow",
      action: "withdrawAll",
      isNativeToken: true,
    });
    if (decoded.status === "swapEscrow") {
      expect(decoded.token).toBeUndefined();
    }
  });

  it("decodes lockToken and lockTokenOpen", () => {
    const lockToken = decodeTransactionCalldata(
      call(
        "lockToken(bytes32,address,address,uint256,uint256)",
        ["bytes32", "address", "address", "uint256", "uint256"],
        [V.H, V.B, V.T, 7n, 1790000000n],
      ),
    );
    expect(lockToken).toMatchObject({
      status: "swapEscrow",
      action: "lockToken",
      amount: 7n,
      timeoutS: 1790000000n,
    });
    if (lockToken.status === "swapEscrow") {
      same(lockToken.token, V.T);
      same(lockToken.recipient, V.B);
    }
    const open = decodeTransactionCalldata(
      call(
        "lockTokenOpen(bytes32,address,uint256,uint256)",
        ["bytes32", "address", "uint256", "uint256"],
        [V.H, V.T, 9n, 1790000000n],
      ),
    );
    expect(open).toMatchObject({
      action: "lockTokenOpen",
      amount: 9n,
      timeoutS: 1790000000n,
    });
    if (open.status === "swapEscrow") same(open.token, V.T);
  });

  it("lists the escrow selectors", () => {
    expect(knownCalldataSelectors()).toEqual(
      expect.arrayContaining(["0xad4c2381", "0x84cc9dfb", "0x7249fbb6"]),
    );
  });

  it.each(["lockNative", "claim", "refund", "withdraw", "pushCredit"] as const)(
    "falls back to unknown for %s with trailing bytes",
    (name) => {
      const data = `${V[name]}00`;
      expect(decodeTransactionCalldata(data).status).toBe("unknown");
      expect(
        decodeTransactionCalldata(`${V[name]}${"00".repeat(64)}`).status,
      ).toBe("unknown");
    },
  );

  it.each(["lockNative", "claim", "refund", "withdraw", "pushCredit"] as const)(
    "falls back to unknown for %s with missing bytes",
    (name) => {
      expect(decodeTransactionCalldata(V[name].slice(0, -2)).status).toBe(
        "unknown",
      );
      expect(decodeTransactionCalldata(V[name].slice(0, -128)).status).toBe(
        "unknown",
      );
      expect(decodeTransactionCalldata(V[name].slice(0, 10))).toEqual({
        status: "unknown",
        selector: V[name].slice(0, 10),
      });
    },
  );

  it("rejects a bytes32 with non-zero padding", () => {
    const tampered = `${V.refund.slice(0, 10 + 64)}${"00".repeat(31)}01`;
    expect(decodeTransactionCalldata(tampered).status).toBe("unknown");
  });

  it("rejects a uint256 above 2^256 hiding in the high half", () => {
    const high = V.lockNativeOpen.slice(0, -128) + "01" + "00".repeat(63);
    expect(decodeTransactionCalldata(high).status).toBe("unknown");
  });

  it("rejects a zero token in lockToken and lockTokenOpen", () => {
    const zero = `Q${"0".repeat(128)}`;
    expect(
      decodeTransactionCalldata(
        call(
          "lockToken(bytes32,address,address,uint256,uint256)",
          ["bytes32", "address", "address", "uint256", "uint256"],
          [V.H, V.B, zero, 7n, 1790000000n],
        ),
      ).status,
    ).toBe("unknown");
    expect(
      decodeTransactionCalldata(
        call(
          "lockTokenOpen(bytes32,address,uint256,uint256)",
          ["bytes32", "address", "uint256", "uint256"],
          [V.H, zero, 9n, 1790000000n],
        ),
      ).status,
    ).toBe("unknown");
  });

  it("keeps the native reading of a zero token in pushCredit", () => {
    const zero = `Q${"0".repeat(128)}`;
    expect(
      decodeTransactionCalldata(
        call(
          "pushCredit(address,address)",
          ["address", "address"],
          [zero, V.A],
        ),
      ),
    ).toMatchObject({ action: "pushCredit", isNativeToken: true });
  });
});
