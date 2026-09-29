import { Button } from "@/components/UI/Button";
import FullAddress from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/FullAddress";
import {
  CALLDATA_ACTIONS,
  decodeTransactionCalldata,
  formatTokenBaseUnits,
  type CalldataAction,
  type DecodedCalldata,
} from "@/functions/decodeTransactionCalldata";
import {
  encodeFunctionSignature,
  encodeParameters,
} from "@theqrl/web3-qrl-abi";
import { BlockTags, type TransactionCall } from "@theqrl/web3-types";
import { useStore } from "@/stores/store";
import type { TokenContractType } from "@/scripts/middlewares/middlewareTypes";
import type { NFTCollectionType } from "@/types/nft";
import StorageUtil from "@/utilities/storageUtil";
import { areAddressesEquivalent } from "@/utilities/addressUtil";
import { AlertTriangle } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Plain-language view of what a contract call actually does, so an
 * unlimited `approve` reads as an unlimited approve instead of a wall of
 * hex (security review finding M2). The raw calldata stays one click away.
 */

type CalldataSummaryProps = {
  data?: string;
  /** The `to` of the request: the contract whose calldata this is. */
  contractAddress: string;
  /** The `from` of the request, which owns the imported token lists. */
  fromAddress: string;
};

/**
 * The ZRC-721 interface id, and the read-only calls used to ask an unknown
 * contract what it is. Both are hints: a node that will not answer, or a
 * contract that does not implement them, simply leaves the surface saying
 * it does not know. Nothing waits on them and nothing is blocked by them.
 */
const ZRC721_INTERFACE_ID = "0x80ac58cd";
const SUPPORTS_INTERFACE_CALLDATA = `${encodeFunctionSignature(
  "supportsInterface(bytes4)",
)}${encodeParameters(["bytes4"], [ZRC721_INTERFACE_ID]).slice(2)}`;
const TOTAL_SUPPLY_CALLDATA = encodeFunctionSignature("totalSupply()");
/** A QRL 2.0 ABI word is 64 bytes, so one return value is 128 hex digits. */
const RETURN_WORD_PATTERN = /^0x[0-9a-fA-F]{128}$/;

const readReturnedWord = (result: unknown): bigint | undefined => {
  if (typeof result !== "string" || !RETURN_WORD_PATTERN.test(result)) {
    return undefined;
  }
  try {
    return BigInt(result);
  } catch {
    return undefined;
  }
};

const ACTION_LABEL_KEYS: Partial<Record<CalldataAction, string>> = {
  approve: "dapp.calldata.actionApprove",
  increaseAllowance: "dapp.calldata.actionIncreaseAllowance",
  decreaseAllowance: "dapp.calldata.actionDecreaseAllowance",
  transfer: "dapp.calldata.actionTransfer",
  transferFrom: "dapp.calldata.actionTransferFrom",
  setApprovalForAll: "dapp.calldata.actionSetApprovalForAll",
  safeTransferFrom: "dapp.calldata.actionSafeTransferFrom",
  safeTransferFromWithData: "dapp.calldata.actionSafeTransferFrom",
  safeTransferFromSingle: "dapp.calldata.actionSafeTransferFromSingle",
  safeBatchTransferFrom: "dapp.calldata.actionSafeBatchTransferFrom",
};

const DetailRow = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div className="flex flex-col gap-1">
    <div className="text-xs">{label}</div>
    <div className="break-words font-bold text-secondary">{children}</div>
  </div>
);

const CalldataSummary = observer(
  ({ data, contractAddress, fromAddress }: CalldataSummaryProps) => {
    const { t } = useTranslation();
    const { contactsStore, qrlStore } = useStore();
    const [token, setToken] = useState<TokenContractType | undefined>();
    const [collection, setCollection] = useState<
      NFTCollectionType | undefined
    >();
    const [isRawVisible, setIsRawVisible] = useState(false);
    const [probedNftStandard, setProbedNftStandard] = useState<
      boolean | undefined
    >();
    const [totalSupply, setTotalSupply] = useState<bigint | undefined>();

    const decoded: DecodedCalldata = useMemo(
      () => decodeTransactionCalldata(data),
      [data],
    );

    useEffect(() => {
      void contactsStore.loadContacts();
    }, [contactsStore]);

    // The imported token and collection lists are stored per account, and
    // the request's own sender is the account whose lists apply. The active
    // account is only a fallback for a request that omitted `from`.
    useEffect(() => {
      let isCurrent = true;
      const owner = fromAddress || qrlStore.activeAccount?.accountAddress || "";
      const resolveAsset = async () => {
        if (!owner || !contractAddress) return;
        try {
          const [tokens, collections] = await Promise.all([
            StorageUtil.getTokenContractsList(owner),
            StorageUtil.getNFTCollectionsList(owner),
          ]);
          if (!isCurrent) return;
          setToken(
            tokens.find((entry) =>
              areAddressesEquivalent(entry.address, contractAddress),
            ),
          );
          setCollection(
            collections.find((entry) =>
              areAddressesEquivalent(entry.address, contractAddress),
            ),
          );
        } catch {
          // An unreadable asset list only costs the symbol and decimals;
          // amounts then render as base units against "unknown token".
          if (!isCurrent) return;
          setToken(undefined);
          setCollection(undefined);
        }
      };
      void resolveAsset();
      return () => {
        isCurrent = false;
      };
    }, [contractAddress, fromAddress, qrlStore.activeAccount?.accountAddress]);

    // Asks the contract itself what it is and how much of it exists, for
    // the two questions the wallet's own lists cannot always answer: is
    // this ambiguous `approve` an NFT approval, and is this allowance
    // larger than the whole supply. Both reads are advisory, run without
    // blocking anything, and are simply absent when the node or the
    // contract does not answer.
    const contractSelector =
      decoded.status === "decoded" ? decoded.selector : undefined;
    useEffect(() => {
      let isCurrent = true;
      const instance = qrlStore.qrlInstance;
      const probeContract = async () => {
        if (!instance || !contractAddress || !contractSelector) return;
        const callContract = async (callData: string) => {
          try {
            return await instance.call(
              {
                to: contractAddress,
                data: callData,
              } as unknown as TransactionCall,
              BlockTags.LATEST,
            );
          } catch {
            return undefined;
          }
        };
        const [interfaceResult, supplyResult] = await Promise.all([
          callContract(SUPPORTS_INTERFACE_CALLDATA),
          callContract(TOTAL_SUPPLY_CALLDATA),
        ]);
        if (!isCurrent) return;
        const interfaceWord = readReturnedWord(interfaceResult);
        setProbedNftStandard(
          interfaceWord === undefined ? undefined : interfaceWord === 1n,
        );
        const supplyWord = readReturnedWord(supplyResult);
        setTotalSupply(supplyWord === 0n ? undefined : supplyWord);
      };
      void probeContract();
      return () => {
        isCurrent = false;
      };
    }, [contractAddress, contractSelector, qrlStore.qrlInstance]);

    if (decoded.status === "empty") return null;

    const contactName = (address: string) =>
      contactsStore.contacts.find((contact) =>
        areAddressesEquivalent(contact.address, address),
      )?.name;

    const renderAddress = (label: string, address: string) => {
      const name = contactName(address);
      return (
        <DetailRow label={label}>
          {name ? <div className="mb-1">{name}</div> : null}
          <FullAddress
            address={address}
            className="w-full font-bold text-identity-accent"
          />
        </DetailRow>
      );
    };

    const renderAmount = (amount: bigint, labelKey: string) => {
      if (token) {
        return (
          <DetailRow label={t(labelKey)}>
            {`${formatTokenBaseUnits(amount, token.decimals)} ${token.symbol}`}
          </DetailRow>
        );
      }
      return (
        <DetailRow label={t(labelKey)}>
          <span>{`${amount.toString()} ${t("dapp.calldata.baseUnits")}`}</span>
          <div className="text-xs font-normal">
            {t("dapp.calldata.unknownToken")}
          </div>
        </DetailRow>
      );
    };

    const rawDisclosure = (
      <div className="flex flex-col gap-1">
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setIsRawVisible((visible) => !visible)}
          aria-expanded={isRawVisible}
        >
          {isRawVisible
            ? t("dapp.calldata.hideRawData")
            : t("dapp.calldata.showRawData")}
        </Button>
        {isRawVisible && (
          <div className="max-h-[8rem] overflow-auto break-all font-numeric text-xs">
            {data}
          </div>
        )}
      </div>
    );

    if (decoded.status === "unknown") {
      return (
        <div className="flex flex-col gap-2 rounded-md border border-foreground/15 p-2">
          <DetailRow label={t("dapp.calldata.action")}>
            {t("dapp.calldata.actionUnknown")}
          </DetailRow>
          {decoded.selector && (
            <DetailRow label={t("dapp.calldata.selector")}>
              <span className="font-numeric">{decoded.selector}</span>
            </DetailRow>
          )}
          <div className="text-xs">{t("dapp.calldata.undecodable")}</div>
          {rawDisclosure}
        </div>
      );
    }

    // `approve` and `transferFrom` are declared by both the fungible and
    // the NFT standard, so their trailing argument is an amount for one and
    // a token ID for the other. The wallet's own lists settle it first; the
    // contract probe is only consulted when they cannot, and when nothing
    // settles it the surface says so instead of guessing. Announcing a
    // fungible allowance for an NFT approval is exactly how an attacker
    // gets an `approve(attacker, 1)` on a valuable collection to read as
    // dust (security review finding M-1).
    const isAmbiguousStandard = decoded.standard === "ZRC20_OR_ZRC721";
    const isKnownToken = token !== undefined;
    const isKnownCollection =
      collection !== undefined || (!isKnownToken && probedNftStandard === true);
    const isUnresolvedStandard =
      isAmbiguousStandard && !isKnownToken && !isKnownCollection;
    const treatAmountAsTokenId =
      decoded.standard === "ZRC721" ||
      (isAmbiguousStandard && !isKnownToken && isKnownCollection);
    const amountLabelKey = isUnresolvedStandard
      ? "dapp.calldata.amountOrTokenId"
      : "dapp.calldata.amount";

    // An allowance above the token's own supply cannot be an amount anyone
    // meant, whatever the number looks like written out. The fixed
    // threshold in the decoder is the floor for when `totalSupply()` is
    // unreadable (security review finding M-2). A token ID is never an
    // allowance, so a resolved NFT approval carries no such warning: QNS
    // name IDs are hashes and are routinely enormous.
    const isAllowanceAction =
      decoded.action === CALLDATA_ACTIONS.APPROVE ||
      decoded.action === CALLDATA_ACTIONS.INCREASE_ALLOWANCE;
    const exceedsTotalSupply =
      totalSupply !== undefined &&
      decoded.amount !== undefined &&
      decoded.amount > totalSupply;
    const showsUnlimitedWarning =
      isAllowanceAction &&
      !treatAmountAsTokenId &&
      (decoded.isUnlimitedAmount === true || exceedsTotalSupply);
    const showsApprovalForAllWarning =
      decoded.action === CALLDATA_ACTIONS.SET_APPROVAL_FOR_ALL &&
      decoded.approved === true;

    const actionLabelKey = (() => {
      if (decoded.action === CALLDATA_ACTIONS.SET_APPROVAL_FOR_ALL) {
        return decoded.approved === true
          ? "dapp.calldata.actionSetApprovalForAll"
          : "dapp.calldata.actionSetApprovalForAllRevoke";
      }
      if (decoded.action === CALLDATA_ACTIONS.APPROVE) {
        if (isKnownToken) return "dapp.calldata.actionApprove";
        if (isKnownCollection) return "dapp.calldata.actionApproveNft";
        return "dapp.calldata.actionApproveAmbiguous";
      }
      return ACTION_LABEL_KEYS[decoded.action] ?? "dapp.calldata.actionUnknown";
    })();

    const ambiguousCautionKey = isUnresolvedStandard
      ? decoded.action === CALLDATA_ACTIONS.APPROVE
        ? "dapp.calldata.approveAmbiguousCaution"
        : "dapp.calldata.transferFromAmbiguousCaution"
      : undefined;

    return (
      <div className="flex flex-col gap-2 rounded-md border border-foreground/15 p-2">
        <DetailRow label={t("dapp.calldata.action")}>
          {t(actionLabelKey)}
        </DetailRow>
        {(token || collection) && (
          <DetailRow label={t("dapp.calldata.token")}>
            {token
              ? token.symbol
              : `${collection?.name ?? ""} (${collection?.symbol ?? ""})`}
          </DetailRow>
        )}
        {ambiguousCautionKey && (
          <div className="text-xs">{t(ambiguousCautionKey)}</div>
        )}
        {showsUnlimitedWarning && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded border border-red-500/60 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {t(
                isUnresolvedStandard
                  ? "dapp.calldata.unlimitedWarningAmbiguous"
                  : "dapp.calldata.unlimitedWarning",
              )}
            </span>
          </div>
        )}
        {showsApprovalForAllWarning && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded border border-red-500/60 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("dapp.calldata.approvalForAllWarning")}</span>
          </div>
        )}
        {decoded.spender !== undefined &&
          renderAddress(t("dapp.calldata.spender"), decoded.spender)}
        {decoded.operator !== undefined &&
          renderAddress(t("dapp.calldata.operator"), decoded.operator)}
        {decoded.source !== undefined &&
          renderAddress(t("dapp.calldata.source"), decoded.source)}
        {decoded.recipient !== undefined &&
          renderAddress(t("dapp.calldata.recipient"), decoded.recipient)}
        {decoded.approved !== undefined && (
          <DetailRow label={t("dapp.calldata.approvalState")}>
            {decoded.approved
              ? t("dapp.calldata.approvalGranted")
              : t("dapp.calldata.approvalRevoked")}
          </DetailRow>
        )}
        {decoded.amount !== undefined &&
          (showsUnlimitedWarning ? (
            <DetailRow label={t(amountLabelKey)}>
              <span>{t("dapp.calldata.unlimited")}</span>
              <div className="font-numeric text-xs font-normal">
                {decoded.amount.toString()}
              </div>
            </DetailRow>
          ) : treatAmountAsTokenId ? (
            <DetailRow label={t("dapp.calldata.tokenId")}>
              <span className="font-numeric">{decoded.amount.toString()}</span>
            </DetailRow>
          ) : (
            renderAmount(decoded.amount, amountLabelKey)
          ))}
        {decoded.tokenIds !== undefined && decoded.tokenIds.length > 0 && (
          <DetailRow
            label={
              decoded.tokenIds.length > 1
                ? t("dapp.calldata.tokenIds")
                : t("dapp.calldata.tokenId")
            }
          >
            <span className="font-numeric">
              {decoded.tokenIds.map((id) => id.toString()).join(", ")}
            </span>
          </DetailRow>
        )}
        {decoded.tokenAmounts !== undefined &&
          decoded.tokenAmounts.length > 0 && (
            <DetailRow label={t("dapp.calldata.quantities")}>
              <span className="font-numeric">
                {decoded.tokenAmounts.map((one) => one.toString()).join(", ")}
              </span>
            </DetailRow>
          )}
        <DetailRow label={t("dapp.calldata.selector")}>
          <span className="font-numeric">{decoded.selector}</span>
        </DetailRow>
        {rawDisclosure}
      </div>
    );
  },
);

export default CalldataSummary;
