import { describe, expect, it } from "vitest";
import { knownSwapEscrow } from "./knownSwapEscrows";

const QS =
  "QBFe68340591f82a68C2258FA2cE7C02Be21E5fc7Bb71615B56a509db4985e863D9243B74da6335C065e257A01d40354653E551907338DBDc7A6b342ea2274437";

describe("knownSwapEscrow", () => {
  it("finds the pinned contract on its chain", () => {
    expect(knownSwapEscrow("0x301825", QS)?.name).toBe("QuantaSwap");
  });

  it("matches the chain id case-insensitively", () => {
    expect(knownSwapEscrow("0X301825", QS)?.name).toBe("QuantaSwap");
  });

  it("matches the address case-insensitively", () => {
    expect(
      knownSwapEscrow("0x301825", `Q${QS.slice(1).toLowerCase()}`)?.name,
    ).toBe("QuantaSwap");
  });

  it("rejects another chain, another address and bad input", () => {
    expect(knownSwapEscrow("0x1", QS)).toBeUndefined();
    expect(knownSwapEscrow("0x301825", `Q${"12".repeat(64)}`)).toBeUndefined();
    expect(knownSwapEscrow(undefined, QS)).toBeUndefined();
    expect(knownSwapEscrow("0x301825", undefined)).toBeUndefined();
  });
});
