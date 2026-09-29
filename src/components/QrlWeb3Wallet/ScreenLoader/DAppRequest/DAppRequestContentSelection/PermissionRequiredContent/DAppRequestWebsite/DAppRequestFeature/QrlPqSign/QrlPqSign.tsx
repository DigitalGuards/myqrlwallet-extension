import { Button } from "@/components/UI/Button";
import { Label } from "@/components/UI/Label";
import FullAddress from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/FullAddress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/UI/Tooltip";
import {
  isWalletLockedError,
  walletLockedProviderError,
} from "@/functions/describeExtensionError";
import { getHexSeedFromMnemonic } from "@/functions/getHexSeedFromMnemonic";
import {
  signMessage,
  signTypedData,
  type TypedDataPayload,
} from "@/functions/pqSigning";
import { RESTRICTED_METHODS } from "@/scripts/constants/requestConstants";
import { revalidateAuthorizedDAppRequest } from "@/scripts/utils/restrictedMethodsMiddlewareUtils";
import { useStore } from "@/stores/store";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";
import { areAddressesEquivalent } from "@/utilities/addressUtil";
import { sanitizeForDisplay } from "@/utilities/stringUtil";
import { useCopy } from "@/hooks/useCopy";
import { Buffer } from "buffer";
import { Check, Copy, X } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";

/**
 * Post-quantum dApp signing screen for `qrl_signMessage` and
 * `qrl_signTypedData` (ML-DSA-87 over a SHAKE256 digest). Both take
 * params `[signerQAddress, messageHexOrPayload]`; on approval the seed is
 * unlocked and pqSigning produces the rich `{ signature, publicKey,
 * descriptor, signer, digest, schemeVersion }` object the SDK verifiers
 * consume. The descriptor lets the verifier bind the public key to signer.
 */
const QrlPqSign = observer(() => {
  const { t } = useTranslation();
  const { copied, failed: copyFailed, copy } = useCopy();
  const { lockStore, qrlStore, dAppRequestStore } = useStore();
  const { getMnemonicPhrases, readLockState } = lockStore;
  const { qrlInstance, qrlConnection } = qrlStore;
  const { isConnected } = qrlConnection;
  const { dAppRequestData, setOnPermissionCallBack, setCanProceed } =
    dAppRequestStore;
  const [isWalletLocked, setIsWalletLocked] = useState(false);

  const method = dAppRequestData?.method;
  const isTypedData = method === RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA;
  const params = dAppRequestData?.params;
  const fromAddress: string = params?.[0] ?? "";
  const payload: unknown = params?.[1];

  // Message-mode display: decode the hex payload to UTF-8 when possible.
  const rawMessage: string = isTypedData
    ? ""
    : typeof payload === "string"
      ? payload
      : "";
  const messageWithoutPrefix =
    rawMessage.startsWith("0x") || rawMessage.startsWith("0X")
      ? rawMessage.slice(2)
      : rawMessage;
  const isHexEncoded =
    /^[0-9a-f]*$/i.test(messageWithoutPrefix) &&
    messageWithoutPrefix.length % 2 === 0;
  const decodedChallenge = isHexEncoded
    ? Buffer.from(messageWithoutPrefix, "hex").toString("utf8")
    : rawMessage;
  const { sanitized: challenge, hadHidden: hasHiddenChars } =
    sanitizeForDisplay(decodedChallenge);

  const typedPayload =
    isTypedData && payload && typeof payload === "object"
      ? (payload as TypedDataPayload)
      : null;

  // The ML-DSA digest binds the whole QRLDomain (hashStruct("QRLDomain",
  // ...)), so surface the fields that decide WHICH contract/chain the
  // signature authorises. Showing only domain.name would be blind signing.
  const domain = typedPayload?.domain;
  const verifyingContract =
    typeof domain?.verifyingContract === "string"
      ? domain.verifyingContract
      : "";
  const domainChainId =
    domain?.chainId !== undefined && domain?.chainId !== null
      ? String(domain.chainId)
      : "";
  const hasChainId = domainChainId !== "";

  useEffect(() => {
    if (isConnected) {
      setOnPermissionCallBack(
        async (hasApproved: boolean, record: ResponseRecorder) => {
          if (hasApproved) {
            const authorization =
              await revalidateAuthorizedDAppRequest(dAppRequestData);
            if (!authorization.canProceed) {
              record({ error: authorization.proceedError });
              return;
            }
            await pqSign(record);
          }
        },
      );
    }
  }, [isConnected, dAppRequestData]);

  useEffect(() => {
    setCanProceed(true);
  }, []);

  const copyMessage = () => {
    void copy(challenge);
  };

  const pqSign = async (record: ResponseRecorder) => {
    try {
      const mnemonicPhrases = await getMnemonicPhrases(fromAddress);
      const seed = getHexSeedFromMnemonic(mnemonicPhrases);
      const addressFromMnemonic =
        qrlInstance?.accounts.seedToAccount(seed)?.address;
      if (!areAddressesEquivalent(fromAddress, addressFromMnemonic)) {
        throw new Error("Mnemonic phrases did not match with the address");
      }
      const result = isTypedData
        ? signTypedData(typedPayload as TypedDataPayload, seed)
        : signMessage(rawMessage, seed);
      record({ ...result });
    } catch (error) {
      if (isWalletLockedError(error)) {
        // getMnemonicPhrases() hit the SW's locked-wallet guard (L1, PR
        // #71 audit): this surface's own isLocked belief was stale. Force
        // a re-check so ScreenLoader can swap to the lock screen, show a
        // translated message here too, and give the dApp a stable
        // EIP-1193 error; the raw guard text never reaches the dApp response.
        setIsWalletLocked(true);
        void readLockState();
        record({ error: walletLockedProviderError() });
        return;
      }
      record({ error });
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md p-2">
      {isWalletLocked && (
        <div className="rounded border border-red-500/60 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300">
          {t("account.walletLockedError")}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <div>{t("dapp.signature.fromAddress")}</div>
        <FullAddress
          address={fromAddress}
          className="w-full font-bold text-secondary"
        />
      </div>

      {isTypedData ? (
        <div className="flex flex-col gap-1">
          <div>{t("dapp.pqSignature.typedData")}</div>
          <div className="text-xs text-amber-600 dark:text-amber-300">
            {t("dapp.pqSignature.typedWarning")}
          </div>
          <div className="flex flex-col gap-1 rounded bg-muted/40 p-2 text-xs">
            <div className="font-semibold text-secondary">
              {String(typedPayload?.domain?.name ?? "")} ·{" "}
              {typedPayload?.primaryType}
            </div>
            {verifyingContract && (
              <div className="min-w-0">
                <span className="text-muted-foreground">
                  {t("dapp.pqSignature.verifyingContract")}:
                </span>
                <FullAddress
                  address={verifyingContract}
                  className="ml-1 text-secondary"
                />
              </div>
            )}
            {hasChainId && (
              <div>
                <span className="text-muted-foreground">
                  {t("dapp.pqSignature.chainId")}:
                </span>{" "}
                <span className="font-mono text-secondary">
                  {domainChainId}
                </span>
              </div>
            )}
          </div>
          {!hasChainId && (
            <div className="rounded border border-amber-500/60 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-200">
              {t("dapp.pqSignature.noChainId")}
            </div>
          )}
          <div className="max-h-[10rem] overflow-auto rounded bg-muted/40 p-2 font-mono text-xs text-secondary">
            <pre className="whitespace-pre-wrap break-words">
              {JSON.stringify(typedPayload?.message ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div>{t("dapp.signature.message")}</div>
          {!isHexEncoded && (
            <div className="text-xs text-amber-600 dark:text-amber-300">
              {t("dapp.pqSignature.notHex")}
            </div>
          )}
          {hasHiddenChars && (
            <div className="text-xs text-red-600">
              {t("dapp.pqSignature.hiddenChars")}
            </div>
          )}
          <div className="flex justify-between gap-2">
            <div className="max-h-[8rem] w-full overflow-auto break-words font-bold text-secondary">
              {challenge}
            </div>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  className={`h-7 w-8 hover:text-secondary ${copyFailed ? "text-destructive" : ""}`}
                  variant="outline"
                  size="icon"
                  aria-label={
                    copyFailed
                      ? t("common.copyFailed")
                      : t("dapp.signature.copyMessage")
                  }
                  onClick={copyMessage}
                >
                  {copyFailed ? (
                    <X size="16" />
                  ) : copied ? (
                    <Check size="16" />
                  ) : (
                    <Copy size="16" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                <Label>{t("dapp.signature.copyMessage")}</Label>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  );
});

export default QrlPqSign;
