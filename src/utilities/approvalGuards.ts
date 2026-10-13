import type {
  BlockchainAdditionalDataType,
  BlockchainDataType,
} from "@/configuration/qrlBlockchainConfig";
import type { DAppRequestType } from "@/scripts/middlewares/middlewareTypes";

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
