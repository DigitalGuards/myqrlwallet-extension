import { describe, expect, it } from "vitest";
import { decodeParameter, encodeParameter } from "@theqrl/web3-qrl-abi";
import {
  FeeMarketEIP1559Transaction,
  seedToAccount,
} from "@theqrl/web3-qrl-accounts";
import { hexToBytes } from "@theqrl/web3-utils";
import { areAddressesEquivalent, isQrlAddress } from "@/utilities/addressUtil";

const EXTENDED_SEED =
  "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";

describe("QIP-55 web3 composition", () => {
  it("derives and ABI-encodes an exact 64-byte address", () => {
    const account = seedToAccount(EXTENDED_SEED);
    const encoded = encodeParameter("address", account.address);

    expect(isQrlAddress(account.address)).toBe(true);
    expect(account.address).toHaveLength(129);
    expect(encoded).toHaveLength(130);
    expect(
      areAddressesEquivalent(
        decodeParameter("address", encoded),
        account.address,
      ),
    ).toBe(true);
  });

  it("signs and verifies a transaction with ML-DSA-87 field widths", () => {
    const account = seedToAccount(EXTENDED_SEED);
    const unsigned = FeeMarketEIP1559Transaction.fromTxData({
      chainId: 1,
      nonce: 0,
      maxPriorityFeePerGas: 1,
      maxFeePerGas: 2,
      gasLimit: 21_000,
      to: account.address,
      value: 1,
      data: "0x",
      accessList: [],
    });
    const signed = unsigned.sign(hexToBytes(EXTENDED_SEED));
    const json = signed.toJSON();

    expect(signed.verifySignature()).toBe(true);
    expect(json.signature).toHaveLength(2 + 4_627 * 2);
    expect(json.publicKey).toHaveLength(2 + 2_592 * 2);
    expect(areAddressesEquivalent(json.to ?? "", account.address)).toBe(true);
  });
});
