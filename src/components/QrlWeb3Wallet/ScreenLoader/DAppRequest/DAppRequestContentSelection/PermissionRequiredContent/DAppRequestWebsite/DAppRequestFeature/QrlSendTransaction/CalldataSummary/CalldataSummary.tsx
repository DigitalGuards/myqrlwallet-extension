import { Button } from "@/components/UI/Button";
import FullAddress from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/FullAddress";
import {
  decodeTransactionCalldata,
  formatTokenBaseUnits,
  type CalldataAction,
  type DecodedCalldata,
} from "@/functions/decodeTransactionCalldata";
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

    // `transferFrom` is declared by both the fungible and the NFT standard,
    // so its third argument is an amount or a token ID depending on the
    // contract. Only an imported token or collection settles it; with
    // neither, the surface says so instead of guessing.
    const treatAmountAsTokenId =
      decoded.standard === "ZRC721" ||
      (decoded.standard === "ZRC20_OR_ZRC721" && !token && !!collection);
    const amountLabelKey =
      decoded.standard === "ZRC20_OR_ZRC721" && !token && !collection
        ? "dapp.calldata.amountOrTokenId"
        : "dapp.calldata.amount";

    const showsUnlimitedWarning = decoded.isUnlimitedAmount === true;
    const showsApprovalForAllWarning =
      decoded.action === "setApprovalForAll" && decoded.approved === true;

    return (
      <div className="flex flex-col gap-2 rounded-md border border-foreground/15 p-2">
        <DetailRow label={t("dapp.calldata.action")}>
          {t(
            decoded.action === "setApprovalForAll" && decoded.approved !== true
              ? "dapp.calldata.actionSetApprovalForAllRevoke"
              : (ACTION_LABEL_KEYS[decoded.action] ??
                  "dapp.calldata.actionUnknown"),
          )}
        </DetailRow>
        {(token || collection) && (
          <DetailRow label={t("dapp.calldata.token")}>
            {token
              ? token.symbol
              : `${collection?.name ?? ""} (${collection?.symbol ?? ""})`}
          </DetailRow>
        )}
        {showsUnlimitedWarning && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded border border-red-500/60 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t("dapp.calldata.unlimitedWarning")}</span>
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
          (decoded.isUnlimitedAmount ? (
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
