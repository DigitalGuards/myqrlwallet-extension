import { describe, expect, it } from "vitest";
import {
  isContractCallEntry,
  isRolledBackContractCall,
} from "./contractCallEntry";
import { V3_CHAIN_ID } from "@/configuration/releaseProfile";

const ESCROW =
  "QBFe68340591f82a68C2258FA2cE7C02Be21E5fc7Bb71615B56a509db4985e863D9243B74da6335C065e257A01d40354653E551907338DBDc7A6b342ea2274437";
const base = {
  to: `Q${"b".repeat(128)}`,
  chainId: V3_CHAIN_ID,
  isZrc20Token: false,
  tokenContractAddress: "",
};

describe("isContractCallEntry", () => {
  it("recognises a locally sent entry that carries call data", () => {
    expect(isContractCallEntry({ ...base, data: "0xa9059cbb00" })).toBe(true);
  });

  it("keeps a plain value transfer as a send", () => {
    expect(isContractCallEntry({ ...base })).toBe(false);
    expect(isContractCallEntry({ ...base, data: "" })).toBe(false);
    expect(isContractCallEntry({ ...base, data: "0x" })).toBe(false);
  });

  it("recognises an explorer entry to a pinned swap escrow", () => {
    expect(isContractCallEntry({ ...base, to: ESCROW })).toBe(true);
    expect(
      isContractCallEntry({ ...base, to: `Q${ESCROW.slice(1).toLowerCase()}` }),
    ).toBe(true);
  });

  it("does not treat the pinned address on another chain as a contract call", () => {
    expect(isContractCallEntry({ ...base, to: ESCROW, chainId: "0x1" })).toBe(
      false,
    );
  });

  it("leaves token rows and internal entries alone", () => {
    expect(
      isContractCallEntry({ ...base, data: "0x1234", isZrc20Token: true }),
    ).toBe(false);
    expect(
      isContractCallEntry({
        ...base,
        data: "0x1234",
        tokenContractAddress: `Q${"c".repeat(128)}`,
      }),
    ).toBe(false);
    expect(
      isContractCallEntry({ ...base, data: "0x1234", isInternal: true }),
    ).toBe(false);
  });
});

describe("isRolledBackContractCall", () => {
  const call = { ...base, data: "0x1234" };

  it("needs a verified failed receipt", () => {
    expect(
      isRolledBackContractCall({
        ...call,
        status: false,
        pendingStatus: "failed",
        receiptStatusVerified: true,
      }),
    ).toBe(true);
  });

  it("does not count a call the node refused before it was mined", () => {
    expect(
      isRolledBackContractCall({
        ...call,
        status: false,
        pendingStatus: "failed",
      }),
    ).toBe(false);
  });

  it("does not count confirmed calls or plain sends", () => {
    expect(
      isRolledBackContractCall({
        ...call,
        status: true,
        pendingStatus: "confirmed",
        receiptStatusVerified: true,
      }),
    ).toBe(false);
    expect(
      isRolledBackContractCall({
        ...base,
        status: false,
        pendingStatus: "failed",
        receiptStatusVerified: true,
      }),
    ).toBe(false);
  });
});
