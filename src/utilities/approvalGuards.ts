import type {
  BlockchainAdditionalDataType,
  BlockchainDataType,
} from "@/configuration/qrlBlockchainConfig";
import type { DAppRequestType } from "@/scripts/middlewares/middlewareTypes";
import type { Eip712TypedData, Eip712TypeDetails } from "@theqrl/web3-types";
import {
  isArrayOf,
  isFiniteNumber,
  isRecord,
  isStorageIdentity,
} from "./storageGuards";

export const isApprovalRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isUnknownArray = (value: unknown): value is unknown[] =>
  Array.isArray(value);

// Approval methods read positional values from arrays or indexed objects.
export const readApprovalParams = (
  value: unknown,
): Record<number, unknown> | undefined =>
  isUnknownArray(value) || isApprovalRecord(value) ? value : undefined;

export const isSwitchQrlChainParameters = (
  value: unknown,
): value is { chainId: string } =>
  isRecord(value) && isStorageIdentity(value.chainId);

type WatchAssetOptions = {
  address: string;
  symbol: string;
  decimals: number;
  image?: unknown;
};

const isWatchAssetOptions = (value: unknown): value is WatchAssetOptions =>
  isRecord(value) &&
  isStorageIdentity(value.address) &&
  typeof value.symbol === "string" &&
  isFiniteNumber(value.decimals) &&
  Number.isInteger(value.decimals) &&
  value.decimals >= 0 &&
  value.decimals <= 36;

export const readWatchAssetOptions = (
  params: unknown,
): WatchAssetOptions | undefined => {
  const request = readApprovalParams(params)?.[0];
  return isRecord(request) && isWatchAssetOptions(request.options)
    ? request.options
    : undefined;
};

const isEip712TypeDetails = (value: unknown): value is Eip712TypeDetails =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.type === "string";

const isEip712TypedData = (value: unknown): value is Eip712TypedData =>
  isRecord(value) &&
  isRecord(value.types) &&
  isArrayOf(value.types.EIP712Domain, isEip712TypeDetails) &&
  Object.values(value.types).every((fields) =>
    isArrayOf(fields, isEip712TypeDetails),
  ) &&
  typeof value.primaryType === "string" &&
  isArrayOf(value.types[value.primaryType], isEip712TypeDetails) &&
  isRecord(value.domain) &&
  Object.values(value.domain).every(
    (field) => typeof field === "string" || isFiniteNumber(field),
  ) &&
  (value.domain.verifyingContract === undefined ||
    typeof value.domain.verifyingContract === "string") &&
  isRecord(value.message);

export const isTypedDataV4Params = (
  value: unknown,
): value is { 0: string; 1: Eip712TypedData } => {
  const params = readApprovalParams(value);
  return typeof params?.[0] === "string" && isEip712TypedData(params[1]);
};

export const readApprovalTransaction = (
  value: unknown,
): Record<string, unknown> | undefined => {
  // Authorization and signing both accept the transaction at params[0].
  if (!isUnknownArray(value) && !isApprovalRecord(value)) return undefined;
  const transaction = isUnknownArray(value) ? value[0] : value["0"];
  return isApprovalRecord(transaction) ? transaction : undefined;
};

export const isStringArray = (value: unknown): value is string[] => {
  if (!isUnknownArray(value)) return false;
  for (const entry of value) {
    if (typeof entry !== "string") return false;
  }
  return true;
};

// The add-chain wire format allows omitted URL lists and a null currency.
export type AddQrlChainParameters = {
  chainId: string;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name?: string; symbol: string; decimals: number } | null;
  blockExplorerUrls?: string[];
  iconUrls?: string[];
};

export type AddedBlockchainData = AddQrlChainParameters &
  BlockchainAdditionalDataType;

export const isAddQrlChainParameters = (
  value: unknown,
): value is AddQrlChainParameters => {
  if (!isApprovalRecord(value)) return false;
  const currency = value.nativeCurrency;
  return (
    typeof value.chainId === "string" &&
    typeof value.chainName === "string" &&
    isStringArray(value.rpcUrls) &&
    (value.blockExplorerUrls === undefined ||
      isStringArray(value.blockExplorerUrls)) &&
    (value.iconUrls === undefined || isStringArray(value.iconUrls)) &&
    (currency === null ||
      (isApprovalRecord(currency) &&
        (currency.name === undefined || typeof currency.name === "string") &&
        typeof currency.symbol === "string" &&
        typeof currency.decimals === "number" &&
        Number.isFinite(currency.decimals)))
  );
};

type ApprovalSender = {
  url?: string;
  favIconUrl?: string;
  title?: string;
  mainFrameOrigin?: string;
};

export const isApprovalSender = (value: unknown): value is ApprovalSender =>
  isApprovalRecord(value) &&
  ["url", "favIconUrl", "title", "mainFrameOrigin"].every(
    (key) => value[key] === undefined || typeof value[key] === "string",
  );

export const isDAppRequest = (value: unknown): value is DAppRequestType => {
  if (!isApprovalRecord(value)) return false;
  const requestData = value.requestData;
  const phishing = value.phishingResult;
  return (
    typeof value.method === "string" &&
    (value.requestId === undefined || typeof value.requestId === "string") &&
    (value.authorizedChainId === undefined ||
      typeof value.authorizedChainId === "string") &&
    (requestData === undefined ||
      (isApprovalRecord(requestData) &&
        (requestData.senderData === undefined ||
          (isApprovalSender(requestData.senderData) &&
            (!("tabId" in requestData.senderData) ||
              requestData.senderData.tabId === undefined ||
              typeof requestData.senderData.tabId === "number"))))) &&
    (phishing === undefined ||
      (isApprovalRecord(phishing) &&
        typeof phishing.isDomainPhishing === "boolean" &&
        (phishing.matchType === undefined ||
          typeof phishing.matchType === "string") &&
        (phishing.matchedDomain === undefined ||
          typeof phishing.matchedDomain === "string") &&
        (phishing.detectorStatus === undefined ||
          phishing.detectorStatus === "ready" ||
          phishing.detectorStatus === "initializing" ||
          phishing.detectorStatus === "unavailable")))
  );
};

// Keep the original records intact; this view only needs their display fields.
export type ApprovalBlockchain = Pick<
  BlockchainDataType,
  "chainId" | "chainName" | "defaultRpcUrl" | "defaultIconUrl"
> &
  Record<string, unknown>;

export const isApprovalBlockchain = (
  value: unknown,
): value is ApprovalBlockchain =>
  isApprovalRecord(value) &&
  typeof value.chainId === "string" &&
  typeof value.chainName === "string" &&
  typeof value.defaultRpcUrl === "string" &&
  typeof value.defaultIconUrl === "string";

export const isApprovalBlockchainList = (
  value: unknown,
): value is ApprovalBlockchain[] => {
  if (!isUnknownArray(value)) return false;
  for (const entry of value) {
    if (!isApprovalBlockchain(entry)) return false;
  }
  return true;
};

type ApprovalGrants = {
  accounts?: string[] | null;
  blockchains?: ApprovalBlockchain[] | null;
};

export const isApprovalGrants = (value: unknown): value is ApprovalGrants =>
  isApprovalRecord(value) &&
  (value.accounts === undefined ||
    value.accounts === null ||
    isStringArray(value.accounts)) &&
  (value.blockchains === undefined ||
    value.blockchains === null ||
    isApprovalBlockchainList(value.blockchains));
