import {
  tokenView,
  nftCollectionView,
  storedText,
} from "@/utilities/storageViews";
import { Button } from "@/components/UI/Button";
import FullAddress from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/FullAddress";
import {
  CALLDATA_ACTIONS,
  SWAP_ESCROW_ACTIONS,
  decodeTransactionCalldata,
  formatTokenBaseUnits,
  type CalldataAction,
  type DecodedCalldata,
  type SwapEscrowAction,
} from "@/functions/decodeTransactionCalldata";
import {
  encodeFunctionSignature,
  encodeParameters,
} from "@theqrl/web3-qrl-abi";
import { BlockTags } from "@theqrl/web3-types";
import { useStore } from "@/stores/store";
import type { TokenContractType } from "@/scripts/middlewares/middlewareTypes";
import type { NFTCollectionType } from "@/types/nft";
import StorageUtil from "@/utilities/storageUtil";
import { withTimeout } from "@/functions/withTimeout";
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
/** No contract read may hold the summary up for longer than this. */
const CONTRACT_PROBE_TIMEOUT_MS = 5_000;

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

const ESCROW_ACTION_LABEL_KEYS: Record<SwapEscrowAction, string> = {
  lockNative: "dapp.calldata.escrowActionLockNative",
  lockToken: "dapp.calldata.escrowActionLockToken",
  lockNativeOpen: "dapp.calldata.escrowActionLockNativeOpen",
  lockTokenOpen: "dapp.calldata.escrowActionLockTokenOpen",
  assign: "dapp.calldata.escrowActionAssign",
  release: "dapp.calldata.escrowActionRelease",
  claim: "dapp.calldata.escrowActionClaim",
  refund: "dapp.calldata.escrowActionRefund",
  withdraw: "dapp.calldata.escrowActionWithdraw",
  withdrawAll: "dapp.calldata.escrowActionWithdraw",
  pushCredit: "dapp.calldata.escrowActionPushCredit",
};

/** A refund time further out than this gets a warning row. */
const FAR_TIMEOUT_SECONDS = 30n * 24n * 60n * 60n;
/** The largest Unix time in seconds a JavaScript Date can hold. */
const MAX_DATE_SECONDS = 8_640_000_000_000n;
/** The native coin has 18 decimals, shown as Quanta. */
const NATIVE_DECIMALS = 18;

const shortenHex = (value: string): string =>
  value.length > 22 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;

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
    const [escrowToken, setEscrowToken] = useState<
      TokenContractType | undefined
    >();

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
      const owner = fromAddress || qrlStore.activeAccount.accountAddress || "";
      const resolveAsset = async () => {
        if (!owner || !contractAddress) return;
        try {
          const [tokens, collections] = await Promise.all([
            StorageUtil.getTokenContractsList(owner),
            StorageUtil.getNFTCollectionsList(owner),
          ]);
          if (!isCurrent) return;
          setToken(
            tokens
              .map(tokenView)
              .find((entry) =>
                areAddressesEquivalent(entry.address, contractAddress),
              ),
          );
          setCollection(
            collections
              .map(nftCollectionView)
              .find((entry) =>
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
    }, [contractAddress, fromAddress, qrlStore.activeAccount.accountAddress]);

    // A swap escrow call names its token as an argument, so the symbol and
    // decimals come from the user's own imported list entry for that
    // address and never from the contract being called.
    const escrowTokenAddress =
      decoded.status === "swapEscrow" ? decoded.token : undefined;
    useEffect(() => {
      let isCurrent = true;
      setEscrowToken(undefined);
      const owner = fromAddress || qrlStore.activeAccount.accountAddress || "";
      const resolveEscrowToken = async () => {
        if (!owner || !escrowTokenAddress) return;
        try {
          const tokens = await StorageUtil.getTokenContractsList(owner);
          if (!isCurrent) return;
          setEscrowToken(
            tokens
              .map(tokenView)
              .find((entry) =>
                areAddressesEquivalent(entry.address, escrowTokenAddress),
              ),
          );
        } catch {
          if (isCurrent) setEscrowToken(undefined);
        }
      };
      void resolveEscrowToken();
      return () => {
        isCurrent = false;
      };
    }, [
      escrowTokenAddress,
      fromAddress,
      qrlStore.activeAccount.accountAddress,
    ]);

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
      // Cleared up front so a previous contract's answers can never be read
      // against a new request while the fresh reads are still in flight.
      setProbedNftStandard(undefined);
      setTotalSupply(undefined);
      const probeContract = async () => {
        if (!instance || !contractAddress || !contractSelector) return;
        const callContract = async (callData: string) => {
          try {
            // A node that hangs must not leave the probe pending for the
            // life of the approval, so each read has its own deadline.
            return await withTimeout(
              instance.call(
                {
                  to: contractAddress,
                  data: callData,
                },
                BlockTags.LATEST,
              ),
              CONTRACT_PROBE_TIMEOUT_MS,
              "Reading the contract",
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
      const name = storedText(contactName(address));
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
      if (
        token &&
        token.decimals !== null &&
        Number.isInteger(token.decimals) &&
        token.decimals >= 0 &&
        token.decimals <= 255
      ) {
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
          onClick={() => {
            setIsRawVisible((visible) => !visible);
          }}
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

    if (decoded.status === "swapEscrow") {
      const action = decoded.action;
      const isLock =
        action === SWAP_ESCROW_ACTIONS.LOCK_NATIVE ||
        action === SWAP_ESCROW_ACTIONS.LOCK_TOKEN ||
        action === SWAP_ESCROW_ACTIONS.LOCK_NATIVE_OPEN ||
        action === SWAP_ESCROW_ACTIONS.LOCK_TOKEN_OPEN;
      const isOpen =
        action === SWAP_ESCROW_ACTIONS.LOCK_NATIVE_OPEN ||
        action === SWAP_ESCROW_ACTIONS.LOCK_TOKEN_OPEN;
      const isCredit =
        action === SWAP_ESCROW_ACTIONS.WITHDRAW ||
        action === SWAP_ESCROW_ACTIONS.WITHDRAW_ALL ||
        action === SWAP_ESCROW_ACTIONS.PUSH_CREDIT;

      const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
      const timeoutS = decoded.timeoutS;
      const timeoutWarningKey =
        timeoutS === undefined
          ? undefined
          : timeoutS <= nowSeconds
            ? "dapp.calldata.escrowTimeoutPast"
            : timeoutS > nowSeconds + FAR_TIMEOUT_SECONDS
              ? "dapp.calldata.escrowTimeoutFar"
              : undefined;
      const timeoutText =
        timeoutS === undefined
          ? ""
          : timeoutS <= MAX_DATE_SECONDS
            ? new Date(Number(timeoutS) * 1000).toLocaleString()
            : timeoutS.toString();

      const renderEscrowAmount = () => {
        if (decoded.amount === undefined) return null;
        if (decoded.isNativeToken) {
          return (
            <DetailRow label={t("dapp.calldata.amount")}>
              {`${formatTokenBaseUnits(decoded.amount, NATIVE_DECIMALS)} Quanta`}
            </DetailRow>
          );
        }
        if (
          escrowToken &&
          escrowToken.decimals !== null &&
          Number.isInteger(escrowToken.decimals) &&
          escrowToken.decimals >= 0 &&
          escrowToken.decimals <= 255
        ) {
          return (
            <DetailRow label={t("dapp.calldata.amount")}>
              {`${formatTokenBaseUnits(decoded.amount, escrowToken.decimals)} ${escrowToken.symbol}`}
            </DetailRow>
          );
        }
        return (
          <DetailRow label={t("dapp.calldata.amount")}>
            <span>{`${decoded.amount.toString()} ${t("dapp.calldata.baseUnits")}`}</span>
            <div className="text-xs font-normal">
              {t("dapp.calldata.unknownToken")}
            </div>
          </DetailRow>
        );
      };

      const noteKey =
        action === SWAP_ESCROW_ACTIONS.CLAIM
          ? "dapp.calldata.escrowNoteClaim"
          : action === SWAP_ESCROW_ACTIONS.REFUND ||
              action === SWAP_ESCROW_ACTIONS.RELEASE
            ? "dapp.calldata.escrowNoteReturn"
            : action === SWAP_ESCROW_ACTIONS.ASSIGN
              ? "dapp.calldata.escrowNoteAssign"
              : isCredit
                ? "dapp.calldata.escrowNoteCredit"
                : undefined;

      return (
        <div className="flex flex-col gap-2 rounded-md border border-foreground/15 p-2">
          <DetailRow label={t("dapp.calldata.action")}>
            {t(ESCROW_ACTION_LABEL_KEYS[action])}
          </DetailRow>
          {decoded.hashlock !== undefined && (
            <DetailRow label={t("dapp.calldata.escrowSwapId")}>
              <span
                className="font-numeric"
                title={decoded.hashlock}
                data-full-value={decoded.hashlock}
              >
                {shortenHex(decoded.hashlock)}
              </span>
            </DetailRow>
          )}
          {isOpen && (
            <DetailRow label={t("dapp.calldata.escrowLockedFor")}>
              <span>{t("dapp.calldata.escrowNoRecipient")}</span>
            </DetailRow>
          )}
          {decoded.recipient !== undefined &&
            renderAddress(
              t(
                isLock
                  ? "dapp.calldata.escrowLockedFor"
                  : "dapp.calldata.escrowNewRecipient",
              ),
              decoded.recipient,
            )}
          {isLock && timeoutS !== undefined && (
            <DetailRow label={t("dapp.calldata.escrowRefundableAfter")}>
              <span>{timeoutText}</span>
            </DetailRow>
          )}
          {timeoutWarningKey && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded border border-red-500/60 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t(timeoutWarningKey)}</span>
            </div>
          )}
          {(isCredit ||
            action === SWAP_ESCROW_ACTIONS.LOCK_TOKEN ||
            action === SWAP_ESCROW_ACTIONS.LOCK_TOKEN_OPEN) && (
            <DetailRow label={t("dapp.calldata.token")}>
              {decoded.isNativeToken ? (
                "Quanta"
              ) : (
                <>
                  {escrowToken ? (
                    <div className="mb-1">{escrowToken.symbol}</div>
                  ) : null}
                  {decoded.token !== undefined && (
                    <FullAddress
                      address={decoded.token}
                      className="w-full font-bold text-identity-accent"
                    />
                  )}
                </>
              )}
            </DetailRow>
          )}
          {renderEscrowAmount()}
          {decoded.to !== undefined &&
            renderAddress(t("dapp.calldata.escrowPayoutTo"), decoded.to)}
          {decoded.account !== undefined &&
            renderAddress(
              t("dapp.calldata.escrowPayoutOwner"),
              decoded.account,
            )}
          {decoded.preimage !== undefined && (
            <DetailRow label={t("dapp.calldata.escrowSecret")}>
              <span
                className="font-numeric"
                title={decoded.preimage}
                data-full-value={decoded.preimage}
              >
                {shortenHex(decoded.preimage)}
              </span>
            </DetailRow>
          )}
          {noteKey && <div className="text-xs">{t(noteKey)}</div>}
          <DetailRow label={t("dapp.calldata.selector")}>
            <span className="font-numeric">{decoded.selector}</span>
          </DetailRow>
          <div className="text-xs">{t("dapp.calldata.escrowHonesty")}</div>
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
    //
    // Only the user's own imported lists may settle the question. The
    // contract probe below may add caution and never remove it: a contract
    // decides for itself what `supportsInterface` returns, so a hybrid
    // token (ERC-404 style) or a maliciously upgraded one could otherwise
    // claim to be a collection and have a real allowance rendered as a
    // harmless token ID with no warning at all.
    const isAmbiguousStandard = decoded.standard === "ZRC20_OR_ZRC721";
    const isKnownToken = token !== undefined;
    const isKnownCollection = collection !== undefined;
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
    // Gated on the imported collection list alone. An unresolved contract
    // keeps the warning however loudly it reports itself as an NFT
    // collection, because the same bytes are a real allowance if it is not
    // one. Importing the collection is what settles it.
    const showsUnlimitedWarning =
      isAllowanceAction &&
      !isKnownCollection &&
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
        // Deliberately not swayed by the probe: the label stays ambiguous
        // until one of the user's own lists settles it.
        return "dapp.calldata.actionApproveAmbiguous";
      }
      return ACTION_LABEL_KEYS[decoded.action] ?? "dapp.calldata.actionUnknown";
    })();

    // The probe's only job: when the contract says it is a collection, the
    // note says the contract says so. It changes no label, no amount and no
    // warning.
    const ambiguousCautionKey = isUnresolvedStandard
      ? decoded.action === CALLDATA_ACTIONS.APPROVE
        ? probedNftStandard === true
          ? "dapp.calldata.approveAmbiguousCautionNftReported"
          : "dapp.calldata.approveAmbiguousCaution"
        : probedNftStandard === true
          ? "dapp.calldata.transferFromAmbiguousCautionNftReported"
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
