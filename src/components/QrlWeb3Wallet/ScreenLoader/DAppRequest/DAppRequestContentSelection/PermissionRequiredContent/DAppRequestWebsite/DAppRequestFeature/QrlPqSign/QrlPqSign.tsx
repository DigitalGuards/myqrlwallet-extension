import { Button } from "@/components/UI/Button";
import { Label } from "@/components/UI/Label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/UI/Tooltip";
import { getHexSeedFromMnemonic } from "@/functions/getHexSeedFromMnemonic";
import {
  signMessage,
  signTypedData,
  type TypedDataPayload,
} from "@/functions/pqSigning";
import { RESTRICTED_METHODS } from "@/scripts/constants/requestConstants";
import { useStore } from "@/stores/store";
import StringUtil, { sanitizeForDisplay } from "@/utilities/stringUtil";
import { Buffer } from "buffer";
import { Copy } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";

/**
 * Post-quantum dApp signing screen for `qrl_signMessage` and
 * `qrl_signTypedData` (ML-DSA-87 over a SHAKE256 digest). Both take
 * params `[signerQAddress, messageHexOrPayload]`; on approval the seed is
 * unlocked and pqSigning produces the rich `{ signature, publicKey, signer,
 * digest, schemeVersion }` object the SDK verifiers consume.
 */
const QrlPqSign = observer(() => {
  const { t } = useTranslation();
  const { lockStore, qrlStore, dAppRequestStore } = useStore();
  const { getMnemonicPhrases } = lockStore;
  const { qrlInstance, qrlConnection } = qrlStore;
  const { isConnected } = qrlConnection;
  const { dAppRequestData, setOnPermissionCallBack, setCanProceed, addToResponseData } =
    dAppRequestStore;

  const method = dAppRequestData?.method;
  const isTypedData = method === RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA;
  const params = dAppRequestData?.params;
  const fromAddress: string = params?.[0] ?? "";
  const payload: unknown = params?.[1];

  const { prefix: prefixFromAddress, addressSplit } = StringUtil.getSplitAddress(fromAddress);

  // Message-mode display: decode the hex payload to UTF-8 when possible.
  const rawMessage: string = isTypedData ? "" : (typeof payload === "string" ? payload : "");
  const messageWithoutPrefix =
    rawMessage.startsWith("0x") || rawMessage.startsWith("0X") ? rawMessage.slice(2) : rawMessage;
  const isHexEncoded =
    /^[0-9a-f]*$/i.test(messageWithoutPrefix) && messageWithoutPrefix.length % 2 === 0;
  const decodedChallenge = isHexEncoded
    ? Buffer.from(messageWithoutPrefix, "hex").toString("utf8")
    : rawMessage;
  const { sanitized: challenge, hadHidden: hasHiddenChars } = sanitizeForDisplay(decodedChallenge);

  const typedPayload = isTypedData && payload && typeof payload === "object"
    ? (payload as TypedDataPayload)
    : null;

  useEffect(() => {
    if (isConnected) {
      setOnPermissionCallBack(async (hasApproved: boolean) => {
        if (hasApproved) {
          await pqSign();
        }
      });
    }
  }, [isConnected]);

  useEffect(() => {
    setCanProceed(true);
  }, []);

  const copyMessage = () => {
    navigator.clipboard.writeText(challenge);
  };

  const pqSign = async () => {
    try {
      const mnemonicPhrases = await getMnemonicPhrases(fromAddress);
      const seed = getHexSeedFromMnemonic(mnemonicPhrases);
      const addressFromMnemonic = qrlInstance?.accounts.seedToAccount(seed)?.address;
      if (fromAddress !== addressFromMnemonic) {
        throw new Error("Mnemonic phrases did not match with the address");
      }
      const result = isTypedData
        ? signTypedData(typedPayload as TypedDataPayload, seed)
        : signMessage(rawMessage, seed);
      addToResponseData({ ...result });
    } catch (error) {
      addToResponseData({ error });
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md p-2">
      <div className="flex flex-col gap-1">
        <div>{t("dapp.signature.fromAddress")}</div>
        <div className="w-64 font-bold text-secondary">
          {`${prefixFromAddress} ${addressSplit.join(" ")}`}
        </div>
      </div>

      {isTypedData ? (
        <div className="flex flex-col gap-1">
          <div>{t("dapp.pqSignature.typedData")}</div>
          <div className="text-xs text-yellow-600">{t("dapp.pqSignature.typedWarning")}</div>
          <div className="max-h-[10rem] overflow-auto rounded bg-muted/40 p-2 font-mono text-xs text-secondary">
            <div>
              {String(typedPayload?.domain?.name ?? "")} · {typedPayload?.primaryType}
            </div>
            <pre className="whitespace-pre-wrap break-words">
              {JSON.stringify(typedPayload?.message ?? {}, null, 2)}
            </pre>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div>{t("dapp.signature.message")}</div>
          {!isHexEncoded && (
            <div className="text-xs text-yellow-600">{t("dapp.pqSignature.notHex")}</div>
          )}
          {hasHiddenChars && (
            <div className="text-xs text-red-600">{t("dapp.pqSignature.hiddenChars")}</div>
          )}
          <div className="flex justify-between gap-2">
            <div className="max-h-[8rem] w-full overflow-hidden break-words font-bold text-secondary">
              {challenge}
            </div>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  className="h-7 w-8 hover:text-secondary"
                  variant="outline"
                  size="icon"
                  aria-label="Copy message"
                  onClick={copyMessage}
                >
                  <Copy size="16" />
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
