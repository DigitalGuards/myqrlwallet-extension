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

  describe("mutations of every escrow signature", () => {
    const TO = 1790000000n;
    const hex = (n: bigint) => n.toString(16).padStart(128, "0");
    const b32 = (h: string) => h.slice(2).padEnd(128, "0");
    const addr = (a: string) => a.slice(1).toLowerCase();
    type Kind = "b32" | "addr" | "uint";
    const CASES: { sig: string; kinds: Kind[]; words: string[] }[] = [
      {
        sig: "lockNative(bytes32,address,uint256)",
        kinds: ["b32", "addr", "uint"],
        words: [b32(V.H), addr(V.B), hex(TO)],
      },
      {
        sig: "lockToken(bytes32,address,address,uint256,uint256)",
        kinds: ["b32", "addr", "addr", "uint", "uint"],
        words: [b32(V.H), addr(V.B), addr(V.T), hex(7n), hex(TO)],
      },
      {
        sig: "lockNativeOpen(bytes32,uint256)",
        kinds: ["b32", "uint"],
        words: [b32(V.H), hex(TO)],
      },
      {
        sig: "lockTokenOpen(bytes32,address,uint256,uint256)",
        kinds: ["b32", "addr", "uint", "uint"],
        words: [b32(V.H), addr(V.T), hex(9n), hex(TO)],
      },
      {
        sig: "assign(bytes32,address)",
        kinds: ["b32", "addr"],
        words: [b32(V.H), addr(V.B)],
      },
      { sig: "release(bytes32)", kinds: ["b32"], words: [b32(V.H)] },
      {
        sig: "claim(bytes32,bytes32)",
        kinds: ["b32", "b32"],
        words: [b32(V.H), b32(V.P)],
      },
      { sig: "refund(bytes32)", kinds: ["b32"], words: [b32(V.H)] },
      {
        sig: "withdraw(address,address,uint256)",
        kinds: ["addr", "addr", "uint"],
        words: [addr(V.T), addr(V.B), hex(5n)],
      },
      {
        sig: "withdrawAll(address,address)",
        kinds: ["addr", "addr"],
        words: [addr(V.T), addr(V.B)],
      },
      {
        sig: "pushCredit(address,address)",
        kinds: ["addr", "addr"],
        words: [addr(V.T), addr(V.A)],
      },
    ];
    const build = (sig: string, words: string[]) =>
      encodeFunctionSignature(sig).toLowerCase() + words.join("");

    it.each(CASES)("$sig decodes canonically", ({ sig, words }) => {
      expect(decodeTransactionCalldata(build(sig, words)).status).toBe(
        "swapEscrow",
      );
    });

    it.each(CASES)("$sig rejects every length mutation", ({ sig, words }) => {
      const ok = build(sig, words);
      const mutated = [
        `${ok}0`,
        `${ok}00`,
        `${ok}${"00".repeat(64)}`,
        ok.slice(0, -1),
        ok.slice(0, -2),
        ok.slice(0, -128),
        ok.slice(0, 10),
      ];
      for (const data of mutated) {
        expect(decodeTransactionCalldata(data).status).not.toBe("swapEscrow");
      }
    });

    it.each(CASES)("$sig rejects dirty padding", ({ sig, kinds, words }) => {
      kinds.forEach((kind, index) => {
        if (kind === "addr") return;
        // A bytes32 keeps its zero padding in the low half of the word and
        // a uint256 keeps its zeros in the high half.
        const offsets = kind === "b32" ? [32, 47, 63] : [0, 15, 31];
        for (const byte of offsets) {
          const word = words[index];
          const dirty = `${word.slice(0, byte * 2)}01${word.slice(byte * 2 + 2)}`;
          const next = words.slice();
          next[index] = dirty;
          expect(decodeTransactionCalldata(build(sig, next)).status).not.toBe(
            "swapEscrow",
          );
        }
      });
    });
  });
});
