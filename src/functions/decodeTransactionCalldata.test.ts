import { describe, expect, it } from "vitest";
import {
  encodeFunctionSignature,
  encodeParameters,
} from "@theqrl/web3-qrl-abi";
import { toChecksumAddress } from "@theqrl/wallet.js";
import {
  CALLDATA_ACTIONS,
  EFFECTIVELY_UNLIMITED_THRESHOLD,
  MAX_UINT256,
  decodeTransactionCalldata,
  formatTokenBaseUnits,
  isUnlimitedAllowance,
  knownCalldataSelectors,
} from "./decodeTransactionCalldata";

const SPENDER = `Q${"ab".repeat(64)}`;
const RECIPIENT = `Q${"cd".repeat(64)}`;
const SOURCE = `Q${"ef".repeat(64)}`;

const call = (signature: string, types: string[], values: unknown[]) =>
  `${encodeFunctionSignature(signature)}${encodeParameters(types, values).slice(2)}`;

describe("decodeTransactionCalldata", () => {
  it("returns empty for calldata that carries nothing", () => {
    expect(decodeTransactionCalldata(undefined)).toEqual({ status: "empty" });
    expect(decodeTransactionCalldata("")).toEqual({ status: "empty" });
    expect(decodeTransactionCalldata("0x")).toEqual({ status: "empty" });
    expect(decodeTransactionCalldata(42)).toEqual({ status: "empty" });
  });

  it("uses the same selectors the encoder produces", () => {
    // The QRL ABI word is 64 bytes, but the 4-byte selector is still the
    // keccak prefix, so these match the familiar values.
    expect(knownCalldataSelectors()).toEqual(
      expect.arrayContaining([
        "0x095ea7b3",
        "0xa9059cbb",
        "0x23b872dd",
        "0xa22cb465",
        "0x2eb2c2d6",
      ]),
    );
  });

  it("decodes approve(address,uint256)", () => {
    const decoded = decodeTransactionCalldata(
      call("approve(address,uint256)", ["address", "uint256"], [SPENDER, "25"]),
    );

    expect(decoded).toMatchObject({
      status: "decoded",
      action: CALLDATA_ACTIONS.APPROVE,
      // Shared with ZRC-721, where the second argument is a token ID.
      standard: "ZRC20_OR_ZRC721",
      selector: "0x095ea7b3",
      spender: toChecksumAddress(SPENDER),
      amount: 25n,
      isUnlimitedAmount: false,
    });
  });

  it("decodes increaseAllowance and decreaseAllowance", () => {
    expect(
      decodeTransactionCalldata(
        call(
          "increaseAllowance(address,uint256)",
          ["address", "uint256"],
          [SPENDER, "7"],
        ),
      ),
    ).toMatchObject({
      action: CALLDATA_ACTIONS.INCREASE_ALLOWANCE,
      spender: toChecksumAddress(SPENDER),
      amount: 7n,
      isUnlimitedAmount: false,
    });

    const decrease = decodeTransactionCalldata(
      call(
        "decreaseAllowance(address,uint256)",
        ["address", "uint256"],
        [SPENDER, MAX_UINT256.toString()],
      ),
    );
    expect(decrease).toMatchObject({
      action: CALLDATA_ACTIONS.DECREASE_ALLOWANCE,
      amount: MAX_UINT256,
    });
    // A decrease can never widen an allowance, so it never carries the flag.
    expect(
      decrease.status === "decoded" ? decrease.isUnlimitedAmount : "missing",
    ).toBeUndefined();
  });

  it("decodes transfer(address,uint256)", () => {
    expect(
      decodeTransactionCalldata(
        call(
          "transfer(address,uint256)",
          ["address", "uint256"],
          [RECIPIENT, "1000000000000000000"],
        ),
      ),
    ).toMatchObject({
      action: CALLDATA_ACTIONS.TRANSFER,
      standard: "ZRC20",
      recipient: toChecksumAddress(RECIPIENT),
      amount: 1000000000000000000n,
    });
  });

  it("decodes transferFrom and marks it as shared between the standards", () => {
    expect(
      decodeTransactionCalldata(
        call(
          "transferFrom(address,address,uint256)",
          ["address", "address", "uint256"],
          [SOURCE, RECIPIENT, "5"],
        ),
      ),
    ).toMatchObject({
      action: CALLDATA_ACTIONS.TRANSFER_FROM,
      standard: "ZRC20_OR_ZRC721",
      source: toChecksumAddress(SOURCE),
      recipient: toChecksumAddress(RECIPIENT),
      amount: 5n,
    });
  });

  it.each([true, false])(
    "decodes setApprovalForAll(address,%s)",
    (approved) => {
      expect(
        decodeTransactionCalldata(
          call(
            "setApprovalForAll(address,bool)",
            ["address", "bool"],
            [SPENDER, approved],
          ),
        ),
      ).toMatchObject({
        action: CALLDATA_ACTIONS.SET_APPROVAL_FOR_ALL,
        standard: "ZRC721",
        operator: toChecksumAddress(SPENDER),
        approved,
      });
    },
  );

  it("decodes both ZRC-721 safeTransferFrom overloads", () => {
    expect(
      decodeTransactionCalldata(
        call(
          "safeTransferFrom(address,address,uint256)",
          ["address", "address", "uint256"],
          [SOURCE, RECIPIENT, "77"],
        ),
      ),
    ).toMatchObject({
      action: CALLDATA_ACTIONS.SAFE_TRANSFER_FROM,
      standard: "ZRC721",
      tokenIds: [77n],
    });

    expect(
      decodeTransactionCalldata(
        call(
          "safeTransferFrom(address,address,uint256,bytes)",
          ["address", "address", "uint256", "bytes"],
          [SOURCE, RECIPIENT, "78", "0xbeef"],
        ),
      ),
    ).toMatchObject({
      action: CALLDATA_ACTIONS.SAFE_TRANSFER_FROM_WITH_DATA,
      standard: "ZRC721",
      source: toChecksumAddress(SOURCE),
      recipient: toChecksumAddress(RECIPIENT),
      tokenIds: [78n],
    });
  });

  it("decodes the ZRC-1155 single transfer", () => {
    expect(
      decodeTransactionCalldata(
        call(
          "safeTransferFrom(address,address,uint256,uint256,bytes)",
          ["address", "address", "uint256", "uint256", "bytes"],
          [SOURCE, RECIPIENT, "9", "3", "0x"],
        ),
      ),
    ).toMatchObject({
      action: CALLDATA_ACTIONS.SAFE_TRANSFER_FROM_SINGLE,
      standard: "ZRC1155",
      tokenIds: [9n],
      tokenAmounts: [3n],
    });
  });

  it("decodes the ZRC-1155 batch transfer", () => {
    expect(
      decodeTransactionCalldata(
        call(
          "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
          ["address", "address", "uint256[]", "uint256[]", "bytes"],
          [SOURCE, RECIPIENT, ["1", "2", "3"], ["10", "20", "30"], "0x"],
        ),
      ),
    ).toMatchObject({
      action: CALLDATA_ACTIONS.SAFE_BATCH_TRANSFER_FROM,
      standard: "ZRC1155",
      source: toChecksumAddress(SOURCE),
      recipient: toChecksumAddress(RECIPIENT),
      tokenIds: [1n, 2n, 3n],
      tokenAmounts: [10n, 20n, 30n],
    });
  });

  it.each([
    ["max uint256", MAX_UINT256],
    // The values that slipped past a 2^255 test and rendered as a plain
    // 60-digit number with no warning at all.
    ["2^254", 1n << 254n],
    ["10^40", 10n ** 40n],
    ["one above 2^128", EFFECTIVELY_UNLIMITED_THRESHOLD + 1n],
  ])("flags an effectively unlimited approve (%s)", (_label, amount) => {
    const decoded = decodeTransactionCalldata(
      call(
        "approve(address,uint256)",
        ["address", "uint256"],
        [SPENDER, amount.toString()],
      ),
    );

    expect(decoded).toMatchObject({ amount, isUnlimitedAmount: true });
  });

  it("flags an effectively unlimited increaseAllowance too", () => {
    expect(
      decodeTransactionCalldata(
        call(
          "increaseAllowance(address,uint256)",
          ["address", "uint256"],
          [SPENDER, (1n << 254n).toString()],
        ),
      ),
    ).toMatchObject({ isUnlimitedAmount: true });
  });

  it("does not flag an allowance at or below the threshold", () => {
    expect(isUnlimitedAllowance(EFFECTIVELY_UNLIMITED_THRESHOLD)).toBe(false);
    expect(isUnlimitedAllowance(EFFECTIVELY_UNLIMITED_THRESHOLD - 1n)).toBe(
      false,
    );
    expect(
      decodeTransactionCalldata(
        call(
          "approve(address,uint256)",
          ["address", "uint256"],
          [SPENDER, EFFECTIVELY_UNLIMITED_THRESHOLD.toString()],
        ),
      ),
    ).toMatchObject({ isUnlimitedAmount: false });
  });

  it("reports an unrecognized selector without decoding it", () => {
    expect(decodeTransactionCalldata(`0xdeadbeef${"00".repeat(64)}`)).toEqual({
      status: "unknown",
      selector: "0xdeadbeef",
    });
  });

  it.each([
    ["truncated arguments", "0x095ea7b31234"],
    ["selector only", "0x095ea7b3"],
    ["shorter than a selector", "0x095e"],
    ["not hex at all", "not-calldata"],
    ["hex with an odd tail", `0xa9059cbb${"zz".repeat(8)}`],
  ])("falls back to raw for malformed calldata (%s)", (_label, data) => {
    const decoded = decodeTransactionCalldata(data);

    expect(decoded.status).toBe("unknown");
  });

  it("does not throw on any malformed input", () => {
    const inputs = [
      "0x",
      "0x0",
      "0x095ea7b3ff",
      `0x2eb2c2d6${"ff".repeat(200)}`,
      `0xa22cb465${"00".repeat(128)}`,
      null,
      {},
    ];

    inputs.forEach((input) => {
      expect(() => decodeTransactionCalldata(input)).not.toThrow();
    });
  });

  it("degrades to raw when a known selector is one word short", () => {
    const short = call(
      "approve(address,uint256)",
      ["address", "uint256"],
      [SPENDER, "5"],
    ).slice(0, 10 + 128);

    expect(decodeTransactionCalldata(short)).toEqual({
      status: "unknown",
      selector: "0x095ea7b3",
    });
  });

  it("degrades to raw when a known call carries trailing bytes", () => {
    const padded = `${call(
      "approve(address,uint256)",
      ["address", "uint256"],
      [SPENDER, "5"],
    )}ffff`;

    expect(decodeTransactionCalldata(padded)).toEqual({
      status: "unknown",
      selector: "0x095ea7b3",
    });
  });

  it("degrades to raw when a uint word overflows its declared width", () => {
    // The ABI coder masks a uint256 to 256 bits, so a 64-byte word holding
    // 2^300 decodes as 0 and an approve for an absurd amount would read as
    // a revoke. The round trip catches it.
    const spenderWord = "ab".repeat(64);
    const overflowWord = (1n << 300n).toString(16).padStart(128, "0");

    expect(
      decodeTransactionCalldata(`0x095ea7b3${spenderWord}${overflowWord}`),
    ).toEqual({ status: "unknown", selector: "0x095ea7b3" });
  });

  it("degrades to raw for a bool word that is neither zero nor one", () => {
    const operatorWord = "ab".repeat(64);
    const nonCanonicalBool = "02".padStart(128, "0");

    expect(
      decodeTransactionCalldata(`0xa22cb465${operatorWord}${nonCanonicalBool}`),
    ).toEqual({ status: "unknown", selector: "0xa22cb465" });
  });

  it("degrades to raw when a batch transfer pairs up unevenly", () => {
    const mismatched = call(
      "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
      ["address", "address", "uint256[]", "uint256[]", "bytes"],
      [SOURCE, RECIPIENT, ["1", "2", "3"], ["10", "20"], "0x"],
    );

    expect(decodeTransactionCalldata(mismatched)).toEqual({
      status: "unknown",
      selector: "0x2eb2c2d6",
    });
  });
});

describe("formatTokenBaseUnits", () => {
  it.each([
    [1000000000000000000n, 18, "1"],
    [1500000000000000000n, 18, "1.5"],
    [1n, 18, "0.000000000000000001"],
    [0n, 18, "0"],
    [250n, 2, "2.5"],
    [12345n, 0, "12345"],
    [-1500n, 3, "-1.5"],
  ])("renders %s at %s decimals as %s", (amount, decimals, expected) => {
    expect(formatTokenBaseUnits(amount, decimals)).toBe(expected);
  });

  it("falls back to base units for an impossible decimals value", () => {
    expect(formatTokenBaseUnits(42n, -1)).toBe("42");
    expect(formatTokenBaseUnits(42n, 1.5)).toBe("42");
    expect(formatTokenBaseUnits(42n, 999)).toBe("42");
  });
});
