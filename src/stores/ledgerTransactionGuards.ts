import {
  Common,
  type AccessListItem,
  type AccessListUint8ArrayItem,
  type FeeMarketEIP1559TxData,
} from "@theqrl/web3-qrl-accounts";
import { isArrayOf, isRecord, isStringArray } from "@/utilities/storageGuards";

const isBytes = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array;

const isNumber = (value: unknown): value is number => typeof value === "number";

const isQuantity = (value: unknown): value is string | number | bigint =>
  typeof value === "string" || isNumber(value) || typeof value === "bigint";

type TransactionAddress = Exclude<
  FeeMarketEIP1559TxData["to"],
  string | Uint8Array | undefined
>;

const isTransactionAddress = (value: unknown): value is TransactionAddress =>
  isRecord(value) &&
  isBytes(value.buf) &&
  typeof value.equals === "function" &&
  typeof value.isZero === "function" &&
  typeof value.toString === "function" &&
  typeof value.toArray === "function";

const isAccessListItem = (value: unknown): value is AccessListItem =>
  isRecord(value) &&
  typeof value.address === "string" &&
  isStringArray(value.storageKeys);

const isAccessListBytes = (value: unknown): value is AccessListUint8ArrayItem =>
  Array.isArray(value) &&
  value.length === 2 &&
  isBytes(value[0]) &&
  isArrayOf(value[1], isBytes);

// The transaction library validates encodings and numeric ranges. This boundary
// checks its input shapes while retaining every supplied field.
export const isLedgerTransactionData = (
  value: unknown,
): value is FeeMarketEIP1559TxData => {
  if (!isRecord(value)) return false;
  for (const field of [
    "nonce",
    "gasLimit",
    "value",
    "descriptor",
    "extraParams",
    "signature",
    "publicKey",
    "maxPriorityFeePerGas",
    "maxFeePerGas",
  ]) {
    const quantity = value[field];
    if (quantity !== undefined && !isQuantity(quantity) && !isBytes(quantity))
      return false;
  }
  return (
    (value.chainId === undefined || isQuantity(value.chainId)) &&
    (value.type === undefined || isQuantity(value.type)) &&
    (value.to === undefined ||
      typeof value.to === "string" ||
      isBytes(value.to) ||
      isTransactionAddress(value.to)) &&
    (value.data === undefined ||
      isQuantity(value.data) ||
      isBytes(value.data) ||
      isArrayOf(value.data, isNumber)) &&
    (value.accessList === undefined ||
      value.accessList === null ||
      isArrayOf(value.accessList, isAccessListItem) ||
      isArrayOf(value.accessList, isAccessListBytes))
  );
};

export const isLedgerCommon = (value: unknown): value is Common | undefined =>
  value === undefined || value instanceof Common;
