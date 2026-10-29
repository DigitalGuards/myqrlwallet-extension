import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import FullAddress from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/FullAddress";
import { isQuantaVaultOrigin } from "@/config/quantaVault";
import type { TokenContractType } from "@/scripts/middlewares/middlewareTypes";
import { formatTokenBaseUnits } from "@/functions/decodeTransactionCalldata";
import { toCanonicalQrlAddress } from "@/utilities/addressUtil";
import {
  hasVaultRefund,
  VAULT_MAX_UINT256,
  type VaultRequest,
} from "@/functions/pqSigning/quantaVault";
import {
  decodeVaultCall,
  vaultRoleLabel,
  type DecodedVaultCall,
  type VaultArgument,
  type VaultAbiValue,
  type VaultCallWarning,
} from "@/functions/pqSigning/quantaVaultCalldata";
import {
  vaultChainNumber,
  escapeVisualControls,
  pageOrigin,
} from "./vaultReviewContext";

type Key = string;
const ARGUMENT_LABELS: Readonly<Record<string, Key>> = {
  _data: "dapp.vault.message",
  _threshold: "dapp.vault.threshold",
  account: "dapp.vault.account",
  amount: "dapp.vault.amount",
  baseGas: "dapp.vault.baseGas",
  calldataPayload: "dapp.vault.data",
  callerConfirmation: "dapp.vault.account",
  data: "dapp.vault.data",
  delay: "dapp.vault.delay",
  gasPrice: "dapp.vault.gasPrice",
  gasToken: "dapp.vault.gasToken",
  guard: "dapp.vault.guard",
  handler: "dapp.vault.handler",
  hashToApprove: "dapp.vault.hash",
  id: "dapp.vault.operationId",
  module: "dapp.vault.module",
  moduleGuard: "dapp.vault.moduleGuard",
  newDelay: "dapp.vault.delay",
  newOwner: "dapp.vault.newOwner",
  oldOwner: "dapp.vault.oldOwner",
  operation: "dapp.vault.operation",
  owner: "dapp.vault.owner",
  payload: "dapp.vault.data",
  payloads: "dapp.vault.data",
  predecessor: "dapp.vault.predecessor",
  prevModule: "dapp.vault.previousModule",
  prevOwner: "dapp.vault.previousOwner",
  recipient: "dapp.vault.to",
  refundReceiver: "dapp.vault.refundReceiver",
  role: "dapp.vault.role",
  safeTxGas: "dapp.vault.txGas",
  salt: "dapp.vault.salt",
  sender: "dapp.vault.sender",
  signatures: "dapp.vault.signatures",
  spender: "dapp.vault.spender",
  target: "dapp.vault.to",
  targetContract: "dapp.vault.to",
  targets: "dapp.vault.to",
  to: "dapp.vault.to",
  transactions: "dapp.vault.data",
  validUntil: "dapp.vault.expiry",
  value: "dapp.vault.value",
  values: "dapp.vault.value",
};
const WARNING_KEYS: Record<VaultCallWarning, Key> = {
  unknownCalldata: "dapp.vault.unknownWarning",
  invalidCalldata: "dapp.vault.invalidWarning",
  invalidOperation: "dapp.vault.invalidOperationWarning",
  depthLimit: "dapp.vault.depthWarning",
  securityChange: "dapp.vault.securityWarning",
  delegateCall: "dapp.vault.delegateWarning",
  opaqueApproval: "dapp.vault.opaqueWarning",
  openRole: "dapp.vault.openRole",
  unlimitedAllowance: "dapp.vault.unlimitedAllowance",
};

/** ABI decoding yields lowercase hex; every address shows its QIP-55 checksum case. */
function VaultAddress({ address }: { address: string }) {
  return (
    <FullAddress address={toCanonicalQrlAddress(address)} className="text-xs" />
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl data-review-block className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-sm" dir="auto">
        {children}
      </dd>
    </dl>
  );
}

function Warning({
  children,
  blocking = false,
}: {
  children: ReactNode;
  blocking?: boolean;
}) {
  return (
    <p
      id={blocking ? "vault-refund-error" : undefined}
      data-review-block
      role="alert"
      className={
        blocking
          ? "rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs font-semibold text-destructive"
          : "rounded-md border border-amber-500/60 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-200"
      }
    >
      {children}
    </p>
  );
}

function formatQuantaValue(value: bigint): string {
  return `${formatTokenBaseUnits(value, 18)} Quanta`;
}

function operationLabel(value: bigint, t: TFunction): string {
  return value === 0n
    ? t("dapp.vault.call")
    : value === 1n
      ? t("dapp.vault.delegateCall")
      : t("dapp.vault.invalidOperation", { value: value.toString() });
}

function expiryLabel(value: bigint, language: string, t: TFunction): string {
  const milliseconds = value * 1000n;
  if (milliseconds > 8640000000000000n)
    return t("dapp.vault.dateRange", { value: value.toString() });
  return t("dapp.vault.localDate", {
    date: new Date(Number(milliseconds)).toLocaleString(language),
  });
}

function tokenAmount(
  value: bigint,
  contract: string,
  ambiguous: boolean,
  token: TokenContractType | undefined,
  t: TFunction,
): ReactNode {
  const decimals = token?.decimals;
  if (
    decimals === undefined ||
    decimals === null ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255 ||
    typeof token?.symbol !== "string" ||
    !token.symbol.trim() ||
    token.symbol.length > 64
  )
    return (
      <div className="space-y-1">
        <div>
          {t(ambiguous ? "dapp.vault.rawAmount" : "dapp.vault.rawTokenAmount", {
            value: value.toString(),
          })}
        </div>
        <VaultAddress address={contract} />
      </div>
    );
  return t("dapp.vault.tokenAmount", {
    value: formatTokenBaseUnits(value, decimals),
    symbol: escapeVisualControls(token.symbol),
  });
}

function argumentValue(
  value: VaultAbiValue,
  arg: VaultArgument,
  contract: string,
  ambiguous: boolean,
  token: TokenContractType | undefined,
  language: string,
  t: TFunction,
): ReactNode {
  if (typeof value !== "string" && typeof value !== "bigint")
    return (
      <ol className="space-y-2">
        {value.map((entry, i) => (
          <li key={i} className="min-w-0 space-y-1">
            <span className="text-xs text-muted-foreground">{i + 1}</span>
            <div>
              {argumentValue(
                entry,
                {
                  ...arg,
                  type:
                    arg.type === "address[]"
                      ? "address"
                      : arg.type === "uint256[]"
                        ? "uint256"
                        : "bytes",
                },
                contract,
                ambiguous,
                token,
                language,
                t,
              )}
            </div>
          </li>
        ))}
      </ol>
    );
  if (typeof value === "bigint") {
    if (arg.name === "operation") return operationLabel(value, t);
    if (arg.name === "amount")
      return tokenAmount(value, contract, ambiguous, token, t);
    if (arg.name === "value" || arg.name === "values")
      return formatQuantaValue(value);
    if (arg.name === "delay" || arg.name === "newDelay")
      return t("dapp.vault.duration", {
        days: (value / 86400n).toString(),
        hours: ((value / 3600n) % 24n).toString(),
        minutes: ((value / 60n) % 60n).toString(),
        seconds: (value % 60n).toString(),
        value: value.toString(),
      });
    if (arg.name === "validUntil") return expiryLabel(value, language, t);
    return value.toString();
  }
  if (arg.type === "address") return <VaultAddress address={value} />;
  if (arg.name === "role")
    return (
      <span className="font-mono text-xs">
        {vaultRoleLabel(value)} {value}
      </span>
    );
  return (
    <pre
      data-review-block
      className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs"
      dir="ltr"
    >
      {value}
    </pre>
  );
}

function CallReview({
  call,
  tokens,
  language,
}: {
  call: DecodedVaultCall;
  tokens: readonly TokenContractType[];
  language: string;
}) {
  const { t } = useTranslation();
  const token = tokens.find(
    (entry) => entry.address.toLowerCase() === call.to.toLowerCase(),
  );
  return (
    <div className="space-y-3">
      <Row label={t("dapp.vault.to")}>
        <VaultAddress address={call.to} />
      </Row>
      {call.batchTarget && (
        <p data-review-block className="text-xs text-muted-foreground">
          {t("dapp.vault.zeroTarget")}
        </p>
      )}
      <Row label={t("dapp.vault.value")}>{formatQuantaValue(call.value)}</Row>
      <Row label={t("dapp.vault.operation")}>
        {operationLabel(call.operation, t)}
      </Row>
      {call.warnings.map((warning, index) => (
        <Warning key={`${warning}-${index}`}>
          {t(WARNING_KEYS[warning])}
        </Warning>
      ))}
      {call.method && (
        <Row label={t("dapp.vault.function")}>
          <span className="font-mono">{call.method}</span>
        </Row>
      )}
      {call.args.map((arg) => (
        <Row
          key={arg.name}
          label={t(ARGUMENT_LABELS[arg.name] ?? "dapp.vault.data")}
        >
          {argumentValue(
            arg.value,
            arg,
            call.to,
            call.method === "approve" || call.method === "transferFrom",
            token,
            language,
            t,
          )}
        </Row>
      ))}
      {call.status === "empty" && (
        <p data-review-block className="text-xs text-muted-foreground">
          {t("dapp.vault.noData")}
        </p>
      )}
      {(call.status === "unknown" || call.status === "invalid") && (
        <Row label={t("dapp.vault.data")}>
          <pre
            data-review-block
            className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs"
            dir="ltr"
          >
            {call.data}
          </pre>
        </Row>
      )}
      {call.children.map((child, i) => (
        <div key={i} className="space-y-3 border-t border-border pt-3">
          <p data-review-block className="font-medium">
            {t("dapp.vault.innerCall", { index: i + 1 })}
          </p>
          <CallReview call={child} tokens={tokens} language={language} />
        </div>
      ))}
    </div>
  );
}

interface Props {
  request: VaultRequest;
  authorizedChainId?: string;
  activeChainId?: string;
  origin?: string;
  parentOrigin?: string;
  knownTokens?: readonly TokenContractType[];
}

const DAppVaultReview = ({
  request,
  authorizedChainId,
  activeChainId,
  origin = "",
  parentOrigin,
  knownTokens = [],
}: Props) => {
  const { t, i18n } = useTranslation();
  const authorizedChain = vaultChainNumber(authorizedChainId);
  const tokens =
    vaultChainNumber(activeChainId) === request.chainId ? knownTokens : [];
  const parent = pageOrigin(parentOrigin);
  const embedded = parent !== undefined && parent !== pageOrigin(origin);
  const title =
    request.kind === "VaultMessage"
      ? "dapp.vault.messageApproval"
      : request.kind === "VaultApproval"
        ? "dapp.vault.approval"
        : "dapp.vault.transaction";
  const tx = request.kind === "VaultMessage" ? null : request.tx;
  const now = BigInt(Math.floor(Date.now() / 1000));
  return (
    <div
      data-testid="vault-review"
      className="max-h-[55vh] min-w-0 space-y-3 overflow-y-auto overscroll-contain pr-1 [overflow-wrap:anywhere]"
    >
      <p data-review-block className="font-semibold">
        {t(title)}
      </p>
      <Row label={t("dapp.vault.address")}>
        <VaultAddress address={request.vault} />
      </Row>
      {request.kind === "VaultApproval" && (
        <Row label={t("dapp.vault.outer")}>
          <VaultAddress address={request.outerVault} />
        </Row>
      )}
      <Row label={t("dapp.vault.network")}>{request.chainId.toString()}</Row>
      {authorizedChain !== undefined && authorizedChain !== request.chainId && (
        <Warning>
          {t("dapp.vault.chainMismatch", {
            domain: request.chainId.toString(),
            authorized: authorizedChain.toString(),
          })}
        </Warning>
      )}
      {!isQuantaVaultOrigin(origin) && (
        <Warning>
          {embedded
            ? t("dapp.vault.embeddedOriginWarning", { parent })
            : t("dapp.vault.originWarning")}
        </Warning>
      )}
      {request.kind === "VaultMessage" && (
        <>
          {request.message.length === 130 && (
            <Warning>{t("dapp.vault.opaqueWarning")}</Warning>
          )}
          <Row label={t("dapp.vault.message")}>
            <pre
              data-review-block
              className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs"
              dir="ltr"
            >
              {request.message}
            </pre>
          </Row>
        </>
      )}
      {tx && (
        <>
          {hasVaultRefund(tx) && (
            <Warning blocking>{t("dapp.vault.refundError")}</Warning>
          )}
          <CallReview
            call={decodeVaultCall(
              tx,
              request.chainId,
              request.kind === "VaultApproval"
                ? request.outerVault
                : request.vault,
            )}
            tokens={tokens}
            language={i18n.language}
          />
          <Row label={t("dapp.vault.nonce")}>{tx.nonce.toString()}</Row>
          <Row label={t("dapp.vault.expiry")}>
            {expiryLabel(tx.validUntil, i18n.language, t)}
          </Row>
          {tx.validUntil < now && (
            <Warning>{t("dapp.vault.expiredWarning")}</Warning>
          )}
          {tx.validUntil === VAULT_MAX_UINT256 ? (
            <Warning>{t("dapp.vault.maxValidity")}</Warning>
          ) : (
            tx.validUntil > now + 30n * 86400n && (
              <Warning>{t("dapp.vault.longValidity")}</Warning>
            )
          )}
          <Row label={t("dapp.vault.txGas")}>{tx.txGas.toString()}</Row>
          <p data-review-block className="text-xs text-muted-foreground">
            {t("dapp.vault.gasInfo")}
          </p>
          {tx.txGas !== 0n && <Warning>{t("dapp.vault.txGasWarning")}</Warning>}
          <Row label={t("dapp.vault.baseGas")}>{tx.baseGas.toString()}</Row>
          <Row label={t("dapp.vault.gasPrice")}>{tx.gasPrice.toString()}</Row>
          <Row label={t("dapp.vault.gasToken")}>
            <VaultAddress address={tx.gasToken} />
          </Row>
          <Row label={t("dapp.vault.refundReceiver")}>
            <VaultAddress address={tx.refundReceiver} />
          </Row>
          <p data-review-block className="text-xs text-muted-foreground">
            {t("dapp.vault.selectorHint")}
          </p>
        </>
      )}
    </div>
  );
};

export default DAppVaultReview;
