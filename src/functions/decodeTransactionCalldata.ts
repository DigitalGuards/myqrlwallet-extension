import {
  decodeParameters,
  encodeFunctionSignature,
  encodeParameters,
} from "@theqrl/web3-qrl-abi";
import { toCanonicalQrlAddress } from "@/utilities/addressUtil";

/**
 * Plain-language decoding of the token calldata a dApp asks the wallet to
 * sign. Without it every contract call renders as one long hex blob, so an
 * unlimited `approve` to an attacker is indistinguishable from a harmless
 * swap (security review finding M2).
 *
 * Scope is deliberately narrow: the handful of ZRC-20 / ZRC-721 / ZRC-1155
 * entry points that move value or hand it away. Anything else is reported
 * as an undecoded contract interaction, with its 4-byte selector shown, so
 * the surface never invents a summary it cannot back up.
 *
 * QRL 2.0 note: the ABI word is 64 bytes and an address fills a whole word,
 * so the byte offsets differ from Ethereum's. Selectors do not: they are
 * still the first four bytes of the keccak hash of the signature, which is
 * why `encodeFunctionSignature` below reproduces the familiar values
 * (`transfer(address,uint256)` is `0xa9059cbb` here too). They are computed
 * rather than hard-coded so the wallet can never disagree with the encoder
 * the rest of the extension signs with.
 */

/**
 * An allowance above 2^128 is past any plausible token supply (a token with
 * 18 decimals would need more than 10^20 whole units to reach it), so it is
 * effectively unlimited whatever the contract holds. The threshold sits
 * here rather than at 2^255 because an attacker picking 2^254, or any long
 * decimal literal, would otherwise clear a 2^255 test and show a harmless
 * looking 60-digit number. Where the surface can read the token's own
 * `totalSupply()` it compares against that as well, and this rule is the
 * floor when that read is unavailable.
 */
export const EFFECTIVELY_UNLIMITED_THRESHOLD = 1n << 128n;

export const MAX_UINT256 = (1n << 256n) - 1n;

export const CALLDATA_ACTIONS = {
  APPROVE: "approve",
  INCREASE_ALLOWANCE: "increaseAllowance",
  DECREASE_ALLOWANCE: "decreaseAllowance",
  TRANSFER: "transfer",
  TRANSFER_FROM: "transferFrom",
  SET_APPROVAL_FOR_ALL: "setApprovalForAll",
  SAFE_TRANSFER_FROM: "safeTransferFrom",
  SAFE_TRANSFER_FROM_WITH_DATA: "safeTransferFromWithData",
  SAFE_TRANSFER_FROM_SINGLE: "safeTransferFromSingle",
  SAFE_BATCH_TRANSFER_FROM: "safeBatchTransferFrom",
} as const;

export type CalldataAction =
  (typeof CALLDATA_ACTIONS)[keyof typeof CALLDATA_ACTIONS];

/**
 * Which token family the signature belongs to. `ZRC20_OR_ZRC721` covers the
 * signatures both standards declare, `approve(address,uint256)` and
 * `transferFrom(address,address,uint256)`: the trailing argument is an
 * amount for a fungible token and a token ID for an NFT, and only the
 * contract at `to` settles which. The surface resolves it from the wallet's
 * own token and collection lists and says "amount or token ID" when it
 * knows neither.
 */
export type TokenStandardHint =
  | "ZRC20"
  | "ZRC721"
  | "ZRC1155"
  | "ZRC20_OR_ZRC721";

export type DecodedCalldataFields = {
  /** approve / increaseAllowance / decreaseAllowance target. */
  spender?: string;
  /** setApprovalForAll target. */
  operator?: string;
  /** transfer / transferFrom / safeTransferFrom destination. */
  recipient?: string;
  /** transferFrom / safeTransferFrom source. */
  source?: string;
  /** Base units for a fungible amount, or the token ID where the standard says so. */
  amount?: bigint;
  /** True when `amount` is an allowance nobody could ever exhaust. */
  isUnlimitedAmount?: boolean;
  /** setApprovalForAll flag. */
  approved?: boolean;
  /** NFT token IDs, one entry for a single transfer, many for a batch. */
  tokenIds?: bigint[];
  /** ZRC-1155 per-ID quantities, index-aligned with `tokenIds`. */
  tokenAmounts?: bigint[];
};

export type DecodedCalldata =
  | { status: "empty" }
  | { status: "unknown"; selector?: string }
  | ({
      status: "decoded";
      selector: string;
      signature: string;
      action: CalldataAction;
      standard: TokenStandardHint;
    } & DecodedCalldataFields);

type CalldataSpec = {
  signature: string;
  action: CalldataAction;
  standard: TokenStandardHint;
  types: string[];
  build: (values: unknown[]) => DecodedCalldataFields;
};

const asAddress = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new Error("Decoded argument is not an address");
  }
  return toCanonicalQrlAddress(value);
};

const asBigInt = (value: unknown): bigint => {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" || typeof value === "number") {
    return BigInt(value);
  }
  throw new Error("Decoded argument is not an integer");
};

const asBigIntList = (value: unknown): bigint[] => {
  if (!Array.isArray(value)) {
    throw new Error("Decoded argument is not an array");
  }
  return value.map(asBigInt);
};

const asBoolean = (value: unknown): boolean => {
  if (typeof value !== "boolean") {
    throw new Error("Decoded argument is not a boolean");
  }
  return value;
};

export const isUnlimitedAllowance = (amount: bigint): boolean =>
  amount > EFFECTIVELY_UNLIMITED_THRESHOLD;

const allowanceFields = (values: unknown[]): DecodedCalldataFields => {
  const amount = asBigInt(values[1]);
  return {
    spender: asAddress(values[0]),
    amount,
    isUnlimitedAmount: isUnlimitedAllowance(amount),
  };
};

const SPECS: CalldataSpec[] = [
  {
    // Shared with ZRC-721, where the second argument is a token ID and the
    // call hands over that one item. Tagged ambiguous so the surface asks
    // the wallet's own lists which contract this is instead of announcing a
    // fungible allowance for an NFT approval.
    signature: "approve(address,uint256)",
    action: CALLDATA_ACTIONS.APPROVE,
    standard: "ZRC20_OR_ZRC721",
    types: ["address", "uint256"],
    build: allowanceFields,
  },
  {
    signature: "increaseAllowance(address,uint256)",
    action: CALLDATA_ACTIONS.INCREASE_ALLOWANCE,
    standard: "ZRC20",
    types: ["address", "uint256"],
    build: allowanceFields,
  },
  {
    signature: "decreaseAllowance(address,uint256)",
    action: CALLDATA_ACTIONS.DECREASE_ALLOWANCE,
    standard: "ZRC20",
    types: ["address", "uint256"],
    // A decrease never widens an allowance, so it carries no unlimited flag.
    build: (values) => ({
      spender: asAddress(values[0]),
      amount: asBigInt(values[1]),
    }),
  },
  {
    signature: "transfer(address,uint256)",
    action: CALLDATA_ACTIONS.TRANSFER,
    standard: "ZRC20",
    types: ["address", "uint256"],
    build: (values) => ({
      recipient: asAddress(values[0]),
      amount: asBigInt(values[1]),
    }),
  },
  {
    signature: "transferFrom(address,address,uint256)",
    action: CALLDATA_ACTIONS.TRANSFER_FROM,
    standard: "ZRC20_OR_ZRC721",
    types: ["address", "address", "uint256"],
    build: (values) => ({
      source: asAddress(values[0]),
      recipient: asAddress(values[1]),
      amount: asBigInt(values[2]),
    }),
  },
  {
    signature: "setApprovalForAll(address,bool)",
    action: CALLDATA_ACTIONS.SET_APPROVAL_FOR_ALL,
    standard: "ZRC721",
    types: ["address", "bool"],
    build: (values) => ({
      operator: asAddress(values[0]),
      approved: asBoolean(values[1]),
    }),
  },
  {
    signature: "safeTransferFrom(address,address,uint256)",
    action: CALLDATA_ACTIONS.SAFE_TRANSFER_FROM,
    standard: "ZRC721",
    types: ["address", "address", "uint256"],
    build: (values) => ({
      source: asAddress(values[0]),
      recipient: asAddress(values[1]),
      tokenIds: [asBigInt(values[2])],
    }),
  },
  {
    signature: "safeTransferFrom(address,address,uint256,bytes)",
    action: CALLDATA_ACTIONS.SAFE_TRANSFER_FROM_WITH_DATA,
    standard: "ZRC721",
    types: ["address", "address", "uint256", "bytes"],
    build: (values) => ({
      source: asAddress(values[0]),
      recipient: asAddress(values[1]),
      tokenIds: [asBigInt(values[2])],
    }),
  },
  {
    signature: "safeTransferFrom(address,address,uint256,uint256,bytes)",
    action: CALLDATA_ACTIONS.SAFE_TRANSFER_FROM_SINGLE,
    standard: "ZRC1155",
    types: ["address", "address", "uint256", "uint256", "bytes"],
    build: (values) => ({
      source: asAddress(values[0]),
      recipient: asAddress(values[1]),
      tokenIds: [asBigInt(values[2])],
      tokenAmounts: [asBigInt(values[3])],
    }),
  },
  {
    signature:
      "safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)",
    action: CALLDATA_ACTIONS.SAFE_BATCH_TRANSFER_FROM,
    standard: "ZRC1155",
    types: ["address", "address", "uint256[]", "uint256[]", "bytes"],
    build: (values) => {
      const tokenIds = asBigIntList(values[2]);
      const tokenAmounts = asBigIntList(values[3]);
      if (tokenIds.length !== tokenAmounts.length) {
        // The standard pairs the two arrays by index, and the contract
        // reverts on a mismatch. Rendering the lists side by side would
        // imply a pairing the calldata does not have.
        throw new Error("Token IDs and quantities do not pair up");
      }
      return {
        source: asAddress(values[0]),
        recipient: asAddress(values[1]),
        tokenIds,
        tokenAmounts,
      };
    },
  },
];

const buildSpecIndex = (): Map<string, CalldataSpec> => {
  const index = new Map<string, CalldataSpec>();
  SPECS.forEach((spec) => {
    index.set(encodeFunctionSignature(spec.signature).toLowerCase(), spec);
  });
  return index;
};

const SPECS_BY_SELECTOR = buildSpecIndex();

/** The selectors this wallet can put into words, for tests and diagnostics. */
export const knownCalldataSelectors = (): string[] => [
  ...SPECS_BY_SELECTOR.keys(),
];

const SELECTOR_HEX_LENGTH = 10; // "0x" + 4 bytes

const readSelector = (data: string): string | undefined => {
  if (!/^0x[0-9a-fA-F]*$/.test(data)) return undefined;
  if (data.length < SELECTOR_HEX_LENGTH) return undefined;
  return data.slice(0, SELECTOR_HEX_LENGTH).toLowerCase();
};

/**
 * Turn transaction calldata into something the approval screen can read out.
 *
 * Never throws. Calldata that is malformed, truncated, or simply not one of
 * the known token calls comes back as `unknown` (with the selector when the
 * bytes contain one), and the surface falls back to showing the raw hex.
 */
export const decodeTransactionCalldata = (data: unknown): DecodedCalldata => {
  if (typeof data !== "string") return { status: "empty" };
  const trimmed = data.trim();
  if (trimmed === "" || trimmed === "0x" || trimmed === "0X") {
    return { status: "empty" };
  }

  const selector = readSelector(trimmed);
  if (!selector) return { status: "unknown" };

  const spec = SPECS_BY_SELECTOR.get(selector);
  if (!spec) return { status: "unknown", selector };

  try {
    const argumentBytes = `0x${trimmed.slice(SELECTOR_HEX_LENGTH)}`;
    const decoded = decodeParameters([...spec.types], argumentBytes);
    const values = spec.types.map((_type, index) => decoded[index]);
    // The ABI coder masks a uint to its declared width, so a 64-byte word
    // holding 2^300 decodes as 0 and an `approve` for an absurd amount
    // would read as a revoke. Re-encoding the decoded values and demanding
    // the exact original bytes back rejects that, along with any other
    // non-canonical encoding (a bool word that is not 0 or 1, a dynamic
    // offset pointing somewhere unexpected, trailing bytes). Anything that
    // fails it is shown as raw calldata instead.
    if (
      encodeParameters([...spec.types], values).toLowerCase() !==
      argumentBytes.toLowerCase()
    ) {
      return { status: "unknown", selector };
    }
    return {
      status: "decoded",
      selector,
      signature: spec.signature,
      action: spec.action,
      standard: spec.standard,
      ...spec.build(values),
    };
  } catch {
    // Truncated or otherwise unparseable arguments for a selector we do
    // recognize. Claiming the action without its arguments would be worse
    // than saying nothing, so this degrades to the raw-hex presentation.
    return { status: "unknown", selector };
  }
};

/**
 * Render an integer base-unit amount at a token's decimals, exactly, with no
 * rounding and no thousands separators. Trailing fraction zeros are dropped
 * so "1.000000000000000000" reads as "1".
 */
export const formatTokenBaseUnits = (
  amount: bigint,
  decimals: number,
): string => {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    return amount.toString();
  }
  if (decimals === 0) return amount.toString();
  const negative = amount < 0n;
  const magnitude = negative ? -amount : amount;
  const scale = 10n ** BigInt(decimals);
  const whole = magnitude / scale;
  const fraction = (magnitude % scale).toString().padStart(decimals, "0");
  const trimmed = fraction.replace(/0+$/, "");
  const body = trimmed === "" ? whole.toString() : `${whole}.${trimmed}`;
  return negative ? `-${body}` : body;
};
