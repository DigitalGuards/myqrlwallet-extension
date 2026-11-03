import { isUnknownArray } from "@/utilities/approvalGuards";
import { isRecord } from "@/utilities/storageGuards";
import type {
  AccessListEntry,
  BlockNumberOrTag,
  Bytes,
  Common,
  Numbers,
  Transaction,
} from "@theqrl/web3-types";

type RpcCustomChain = {
  [Field in keyof Common["customChain"]]?: Common["customChain"][Field] | null;
};

type RpcCommon = {
  customChain?: RpcCustomChain | null;
  baseChain?: string | null;
  hardfork?: string | null;
};

// Web3 normalizes byte-array storage keys before RPC, as it does for the
// transaction's top-level byte fields. AccessListEntry only declares hex keys.
type RpcAccessListEntry = Omit<AccessListEntry, "storageKeys"> & {
  storageKeys?: Bytes[];
};

type RpcTransaction = {
  [Field in keyof Transaction]: Field extends "common"
    ? RpcCommon | null
    : Field extends "accessList"
      ? RpcAccessListEntry[] | null
      : Field extends "chain" | "hardfork"
        ? string | null
        : Transaction[Field] | null;
};

// Web3 treats null transaction fields, including nested common/customChain
// metadata, as unset and accepts creation calls with an omitted recipient.
// Nested metadata fields can also be omitted. Simulation also passes chain
// and hardfork strings through without applying the literal restrictions in
// its published signing types. prepareRpcTransactionInput below reconciles
// the fields web3 2.0.0 started refusing; everything else is left for Web3
// to normalize.
export type RpcTransactionContext = {
  call(
    transaction: RpcTransaction,
    blockNumber?: BlockNumberOrTag,
  ): Promise<Bytes>;
  estimateGas(transaction: RpcTransaction): Promise<Numbers>;
};

// Web3's block wrappers normalize byte-array hashes. The public method
// signatures expose only string hashes and block numbers.
export type RpcBlockContext = {
  getBlock(
    block?: BlockNumberOrTag | Bytes,
    hydrated?: boolean,
  ): Promise<unknown>;
  getBlockTransactionCount(block?: BlockNumberOrTag | Bytes): Promise<Numbers>;
  getTransactionFromBlock(
    block: BlockNumberOrTag | Bytes | undefined,
    transactionIndex: Numbers,
  ): Promise<unknown>;
};

export const isRpcString = (value: unknown): value is string =>
  typeof value === "string";

export const isRpcNumber = (value: unknown): value is Numbers =>
  typeof value === "string" ||
  typeof value === "bigint" ||
  (typeof value === "number" && Number.isFinite(value));

export const isOptionalRpcNumber = (
  value: unknown,
): value is Numbers | undefined => value === undefined || isRpcNumber(value);

export const isOptionalRpcBoolean = (
  value: unknown,
): value is boolean | undefined =>
  value === undefined || typeof value === "boolean";

export const isRpcBytes = (value: unknown): value is Bytes =>
  typeof value === "string" || value instanceof Uint8Array;

export const isOptionalRpcBlock = (
  value: unknown,
): value is BlockNumberOrTag | Bytes | undefined =>
  isOptionalRpcNumber(value) || isRpcBytes(value);

const isArrayOf = <T>(
  value: unknown,
  guard: (entry: unknown) => entry is T,
): value is T[] => {
  if (!isUnknownArray(value)) return false;
  for (const entry of value) {
    if (!guard(entry)) return false;
  }
  return true;
};

export const isRpcBytesArray = (value: unknown): value is Bytes[] =>
  isArrayOf(value, isRpcBytes);

export const isRpcNumberArray = (value: unknown): value is Numbers[] =>
  isArrayOf(value, isRpcNumber);

const isUnsetRpcField = (value: unknown): value is null | undefined =>
  value === undefined || value === null;

const isRpcCustomChain = (value: unknown): value is RpcCustomChain =>
  isRecord(value) &&
  (isUnsetRpcField(value.name) || typeof value.name === "string") &&
  (isUnsetRpcField(value.networkId) || isRpcNumber(value.networkId)) &&
  (isUnsetRpcField(value.chainId) || isRpcNumber(value.chainId));

const isRpcCommon = (value: unknown): value is RpcCommon =>
  isRecord(value) &&
  (isUnsetRpcField(value.customChain) || isRpcCustomChain(value.customChain)) &&
  (isUnsetRpcField(value.baseChain) || typeof value.baseChain === "string") &&
  (isUnsetRpcField(value.hardfork) || typeof value.hardfork === "string");

const isAccessListEntry = (value: unknown): value is RpcAccessListEntry =>
  isRecord(value) &&
  (value.address === undefined || typeof value.address === "string") &&
  (value.storageKeys === undefined || isRpcBytesArray(value.storageKeys));

// Keep the transaction intact, including extension fields. Web3 and the node
// perform encoding and semantic validation after this shape check.
export const isRpcTransaction = (value: unknown): value is RpcTransaction => {
  if (!isRecord(value)) return false;
  return (
    (isUnsetRpcField(value.from) || typeof value.from === "string") &&
    (isUnsetRpcField(value.to) || typeof value.to === "string") &&
    [
      "value",
      "gas",
      "type",
      "maxFeePerGas",
      "maxPriorityFeePerGas",
      "nonce",
      "chainId",
      "networkId",
      "gasLimit",
    ].every((key) => isUnsetRpcField(value[key]) || isRpcNumber(value[key])) &&
    [
      "data",
      "input",
      "descriptor",
      "extraParams",
      "signature",
      "publicKey",
    ].every((key) => isUnsetRpcField(value[key]) || isRpcBytes(value[key])) &&
    (isUnsetRpcField(value.accessList) ||
      isArrayOf(value.accessList, isAccessListEntry)) &&
    (isUnsetRpcField(value.common) || isRpcCommon(value.common)) &&
    (isUnsetRpcField(value.chain) || typeof value.chain === "string") &&
    (isUnsetRpcField(value.hardfork) || typeof value.hardfork === "string")
  );
};

const withoutNullFields = <T extends object>(record: T): T => {
  const copy = { ...record };
  for (const [key, field] of Object.entries(copy)) {
    if (field === null) Reflect.deleteProperty(copy, key);
  }
  return copy;
};

const RPC_QUANTITY_FIELDS = [
  "value",
  "gas",
  "gasLimit",
  "type",
  "maxFeePerGas",
  "maxPriorityFeePerGas",
  "nonce",
  "chainId",
  "networkId",
] as const satisfies readonly (keyof RpcTransaction)[];

/**
 * Reconciles a dApp's qrl_estimateGas / qrl_call object with
 * @theqrl/web3 2.0.0, so the node receives the same request it did on 1.0.3.
 *
 * 2.0.0 checks these objects locally before they reach the node, and it
 * treats four kinds of input differently from 1.0.3:
 *
 * - `gasPrice` throws InvalidPropertiesForTransactionTypeError. 1.0.3
 *   dropped the field from the request, so it is removed here.
 * - `gas` and `gasLimit` that differ throw. 1.0.3 sent `gasLimit` as `gas`,
 *   so `gasLimit` is folded into `gas` the same way.
 * - An integral JS number above Number.MAX_SAFE_INTEGER throws
 *   InvalidNumberError. 1.0.3 sent its exact value as a hex quantity, so it
 *   is converted to that hex string. A fractional or negative number is
 *   left as it is: 1.0.3 sent those on as values the node refuses
 *   (-32602), and 2.0.0 either does the same or refuses them itself.
 * - null fields, including those inside `common` and its `customChain`,
 *   are sent as null. 1.0.3 left them out of the request, so they are
 *   removed.
 *
 * The input is not modified; a prepared copy is returned.
 */
export const prepareRpcTransactionInput = (
  transaction: RpcTransaction,
): RpcTransaction => {
  const prepared = withoutNullFields(transaction);
  Reflect.deleteProperty(prepared, "gasPrice");
  if (prepared.common) {
    const common = withoutNullFields(prepared.common);
    if (common.customChain) {
      common.customChain = withoutNullFields(common.customChain);
    }
    prepared.common = common;
  }
  for (const key of RPC_QUANTITY_FIELDS) {
    const field = prepared[key];
    if (
      typeof field === "number" &&
      Number.isInteger(field) &&
      field > Number.MAX_SAFE_INTEGER
    ) {
      prepared[key] = `0x${BigInt(field).toString(16)}`;
    }
  }
  if (prepared.gasLimit !== undefined) {
    prepared.gas = prepared.gasLimit;
    delete prepared.gasLimit;
  }
  return prepared;
};

export const readRpcParameter = <T>(
  value: unknown,
  guard: (candidate: unknown) => candidate is T,
): T => {
  if (!guard(value)) throw new Error("Invalid QRL RPC parameter.");
  return value;
};

export const readRpcParams = (value: unknown): unknown[] => {
  if (value === undefined || value === null) return [];
  return readRpcParameter(value, isUnknownArray);
};
