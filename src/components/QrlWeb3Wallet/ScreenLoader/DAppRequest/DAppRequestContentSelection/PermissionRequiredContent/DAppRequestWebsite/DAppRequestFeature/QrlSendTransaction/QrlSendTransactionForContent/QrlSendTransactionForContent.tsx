import { V3_CHAIN_ID } from "@/configuration/releaseProfile";
import { Button } from "@/components/UI/Button";
import { Label } from "@/components/UI/Label";
import FullAddress from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/FullAddress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/UI/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/UI/Tooltip";
import { NATIVE_TOKEN } from "@/constants/nativeToken";
import { SIGNING_NONCE_BLOCK_TAG } from "@/constants/transactionNonce";
import {
  isWalletLockedError,
  walletLockedProviderError,
} from "@/functions/describeExtensionError";
import { getHexSeedFromMnemonic } from "@/functions/getHexSeedFromMnemonic";
import { useStore } from "@/stores/store";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import { areAddressesEquivalent } from "@/utilities/addressUtil";
import { Copy } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { SEND_TRANSACTION_TYPES } from "../QrlSendTransaction";
import { utils, qrl } from "@theqrl/web3";
import {
  ContractExecutionError,
  Eip838ExecutionError,
  TransactionRevertInstructionError,
} from "@theqrl/web3-errors";
import { isHexStrict } from "@theqrl/web3-validator";
import { BlockTags, type TransactionCall } from "@theqrl/web3-types";
import { revalidateAuthorizedDAppRequest } from "@/scripts/utils/restrictedMethodsMiddlewareUtils";
import { TimeoutError, withTimeout } from "@/functions/withTimeout";
import {
  capSimulationTimeoutMs,
  floorBroadcastTimeoutMs,
} from "@/functions/sendBudget";

const { Common } = qrl.accounts;

// Bounds, in total, how long the popup waits on the node for the pre-flight
// simulation plus the broadcast. requestManager.send() has no timeout of
// its own, and an unbounded wait here can outlast the middleware's 90 s
// safety timeout just as badly as waiting for a receipt used to. The two
// steps share this one budget (see broadcastTransaction): the simulation
// is capped at SIMULATION_TIMEOUT_CAP_MS so it can never eat most of it,
// and the broadcast is floored at BROADCAST_TIMEOUT_FLOOR_MS so it always
// gets a real window even in that case. The combined worst case (the cap
// plus the floor, or the full shared budget, whichever is larger) stays
// well inside the 90 s the middleware allows for the whole approval.
const SEND_BUDGET_MS = 30 * 1000;
const SIMULATION_TIMEOUT_CAP_MS = 15 * 1000;
const BROADCAST_TIMEOUT_FLOOR_MS = 5 * 1000;

/**
 * Thrown when the broadcast itself timed out. requestManager.send() gives
 * no signal on timeout about whether the node actually accepted the
 * transaction, so it may already be in the mempool; qrl_sendRawTransaction
 * is not safely retryable without risking a double-spend from a second,
 * differently-nonced signature. Carrying the locally computed hash lets the
 * dApp, and the service-worker watch registered for it, check the real
 * outcome.
 */
export class TransactionMayStillBeProcessingError extends Error {
  constructor(public readonly transactionHash: string) {
    super(
      `The transaction was not confirmed within the wait time. It may still be processing. Check its status with hash ${transactionHash} before retrying.`,
    );
    this.name = "TransactionMayStillBeProcessingError";
  }
  // sanitizeError/getSerializableObject (scriptUtils.ts) forward an error's
  // own `data` verbatim, which is how the middleware recovers this hash to
  // register a watch for an approved request that still ended in an error.
  get data() {
    return { transactionHash: this.transactionHash, pending: true };
  }
}

// The Ledger path has no signTransaction result to read a hash from, so it
// derives one itself with sha3Raw, the same function signTransaction uses
// internally. sha3Raw falls back to hashing a string's UTF-8 bytes for
// anything that is not strict hex (@theqrl/web3-utils' sha3), so a
// malformed raw transaction would otherwise be hashed as if it were text,
// producing a hash for a "transaction" that was never signed. isHexStrict
// guards that: a raw transaction that fails it is treated as a signing
// failure, the same as no raw transaction at all.
const hashRawTransaction = (rawTransaction: string): string => {
  if (!isHexStrict(rawTransaction)) {
    throw new Error("The signed transaction is not valid hex");
  }
  return utils.sha3Raw(rawTransaction);
};

type TransactionObject = {
  chainId: string;
  from: string;
  to?: string;
  data?: string;
  gas: string;
  value?: string;
  nonce: bigint | undefined;
  type?: string;
  maxPriorityFeePerGas?: bigint;
  maxFeePerGas?: string;
  gasPrice?: bigint | undefined;
};

type QrlSendTransactionForContentProps = {
  transactionType: keyof typeof SEND_TRANSACTION_TYPES;
};

const QrlSendTransactionForContent = observer(
  ({ transactionType }: QrlSendTransactionForContentProps) => {
    const { t } = useTranslation();
    const {
      lockStore,
      qrlStore,
      dAppRequestStore,
      ledgerStore,
      transactionHistoryStore,
    } = useStore();
    const { getMnemonicPhrases, readLockState } = lockStore;
    const { qrlInstance, getGasFeeData, qrlConnection } = qrlStore;
    const { isConnected, blockchain } = qrlConnection;
    const [isWalletLocked, setIsWalletLocked] = useState(false);
    const {
      dAppRequestData,
      setOnPermissionCallBack,
      setCanProceed,
      addToResponseData,
    } = dAppRequestStore;

    const params = dAppRequestData?.params[0];
    const accountFromAddress = params?.from ?? "";
    const accountToAddress = params?.to ?? "";
    const value = BigInt(params?.value ?? 0);
    const gasLimit = BigInt(params?.gas ?? 0);
    const data = params?.data;

    useEffect(() => {
      if (isConnected) {
        const onPermissionCallBack = async (hasApproved: boolean) => {
          if (hasApproved) {
            const authorization =
              await revalidateAuthorizedDAppRequest(dAppRequestData);
            if (!authorization.canProceed) {
              addToResponseData({ error: authorization.proceedError });
              return;
            }
            if (transactionType === SEND_TRANSACTION_TYPES.QRL_TRANSFER) {
              await sendZndTransfer();
            } else {
              await deployContractOrInteract();
            }
          }
        };
        setOnPermissionCallBack(onPermissionCallBack);
      }
    }, [isConnected, transactionType, dAppRequestData]);

    const copyData = () => {
      navigator.clipboard.writeText(data);
    };

    // Reads the instance and stops right here with the same shaped error
    // ensureSigningContext already throws for a changed network. A bare
    // non-null assertion on a stale (disconnected) instance would crash
    // with an unrelated TypeError.
    const requireQrlInstance = () => {
      if (!qrlInstance) {
        throw new Error("The network changed. Review the request again.");
      }
      return qrlInstance;
    };

    const ensureSigningContext = async () => {
      const authorization =
        await revalidateAuthorizedDAppRequest(dAppRequestData);
      if (!authorization.canProceed) throw authorization.proceedError;
      if (
        qrlInstance !== qrlStore.qrlInstance ||
        blockchain !== qrlStore.qrlConnection.blockchain ||
        blockchain.chainId.toLowerCase() !== V3_CHAIN_ID
      ) {
        throw new Error("The network changed. Review the request again.");
      }
    };

    // Mirrors @theqrl/web3-qrl's default checkRevertBeforeSending behaviour
    // (rpc_method_wrappers.js sendSignedTransaction): qrl_call the
    // about-to-be-signed transaction first, and on revert fail without ever
    // broadcasting. getRevertReason/getTransactionError (web3-qrl/utils) are
    // internal helpers the package does not re-export, so their shaping is
    // reproduced here from the exported error classes. qrlInstance.call()
    // runs the identical qrl_call and throws the identical
    // ContractExecutionError on revert, so the dApp still gets an error of
    // the same class it always did, and the reverting transaction never
    // reaches the node's mempool. Queried against the "pending" block so a
    // transaction that depends on one still in the mempool (an approve
    // ahead of the swap it authorizes) is not rejected for a state that is
    // already about to change.
    const simulateTransaction = async (
      transaction: TransactionObject,
      timeoutMs: number,
    ) => {
      const instance = requireQrlInstance();
      try {
        // `to` is optional here (a contract deployment has none), but
        // TransactionCall's type declares it required; qrl_call accepts an
        // absent `to` for a deployment simulation the same way sending one
        // does. TransactionCall's type is simply narrower than the request
        // it needs to accept here.
        await withTimeout(
          instance.call(
            transaction as unknown as TransactionCall,
            BlockTags.PENDING,
          ),
          timeoutMs,
          "Simulating the transaction",
        );
      } catch (error) {
        if (
          error instanceof ContractExecutionError &&
          error.innerError instanceof Eip838ExecutionError
        ) {
          const revertData =
            typeof error.innerError.data === "string"
              ? error.innerError.data
              : undefined;
          throw new TransactionRevertInstructionError(
            error.innerError.message,
            revertData?.slice(0, 10),
            undefined,
            revertData?.substring(10),
          );
        }
        throw error;
      }
    };

    // Answers the dApp as soon as the node accepts the transaction, which is
    // all qrl_sendTransaction owes it. Waiting for the receipt held the dApp
    // for a whole block, and at 60 s slots that ran past the middleware's
    // 90 s safety timeout. The service worker's dApp-transaction watcher
    // (registered by restrictedMethodsMiddleware once it answers) confirms
    // the transaction and fires the notification, so this surface (and any
    // notification/popup window it lives in) can close the moment it has
    // answered.
    const broadcastTransaction = async (
      rawTransaction: string,
      transaction: TransactionObject,
      precomputedHash: string,
    ) => {
      const instance = requireQrlInstance();
      await ensureSigningContext();
      // Simulation and broadcast share one SEND_BUDGET_MS deadline, split
      // explicitly between the two: capping the simulation and flooring
      // the broadcast keeps a slow simulation from squeezing the broadcast
      // down to (near) zero.
      const deadline = Date.now() + SEND_BUDGET_MS;
      await simulateTransaction(
        transaction,
        capSimulationTimeoutMs(
          deadline - Date.now(),
          SIMULATION_TIMEOUT_CAP_MS,
        ),
      );
      try {
        const transactionHash: unknown = await withTimeout(
          instance.requestManager.send({
            method: "qrl_sendRawTransaction",
            params: [rawTransaction],
          }),
          floorBroadcastTimeoutMs(
            deadline - Date.now(),
            BROADCAST_TIMEOUT_FLOOR_MS,
          ),
          "Broadcasting the transaction",
        );
        if (typeof transactionHash !== "string" || !transactionHash) {
          throw new Error("The node did not return a transaction hash");
        }
        return transactionHash;
      } catch (error) {
        if (error instanceof TimeoutError) {
          throw new TransactionMayStillBeProcessingError(precomputedHash);
        }
        throw error;
      }
    };

    const recordPendingTransaction = async ({
      from,
      to,
      value,
      data,
      transactionHash,
      isQrlTransfer,
      nonce,
      maxFeePerGas,
      maxPriorityFeePerGas,
      gasLimit,
    }: {
      from?: string;
      to?: string;
      value?: string | bigint | number;
      data?: string;
      transactionHash: string;
      isQrlTransfer: boolean;
      // Carried through so speed-up/cancel in TransactionDetail has a nonce
      // and fee baseline for this dApp-originated entry, the same as a
      // wallet-initiated send (TokenTransfer.tsx).
      nonce?: bigint;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: bigint;
      gasLimit?: string;
    }) => {
      if (!from) return;
      try {
        const tokenSymbol =
          blockchain?.nativeCurrency?.symbol ?? NATIVE_TOKEN.symbol;
        const tokenName = blockchain?.nativeCurrency?.name ?? tokenSymbol;
        const valueAsBigInt =
          value !== undefined && value !== null
            ? typeof value === "bigint"
              ? value
              : BigInt(value)
            : 0n;
        // fromPlanck already returns an exact decimal string; wrapping it
        // in Number() (as this used to) truncates it to float precision,
        // and signAndSendReplacementTransaction (qrlStore.ts) later feeds
        // this same field back into toPlanck() to rebuild the value for
        // Speed Up/cancel. TokenTransfer.tsx stores a wallet-initiated
        // send's amount as a string for the same reason. The history
        // screen's own formatTransactionAmount already expects (and
        // parses) a decimal string, so display is unaffected.
        const amount = isQrlTransfer
          ? utils.fromPlanck(valueAsBigInt, "quanta")
          : 0;
        const entry: TransactionHistoryEntry = {
          id: transactionHash,
          from,
          to: to ?? "",
          amount,
          tokenSymbol,
          tokenName,
          isZrc20Token: false,
          tokenContractAddress: "",
          tokenDecimals: 18,
          transactionHash,
          blockNumber: "",
          gasUsed: "",
          effectiveGasPrice: "",
          status: false,
          timestamp: Date.now(),
          chainId: blockchain?.chainId ?? "",
          pendingStatus: "pending",
          data: data ?? undefined,
          nonce: nonce !== undefined ? Number(nonce) : undefined,
          maxFeePerGas:
            maxFeePerGas !== undefined
              ? BigInt(maxFeePerGas).toString()
              : undefined,
          maxPriorityFeePerGas:
            maxPriorityFeePerGas !== undefined
              ? maxPriorityFeePerGas.toString()
              : undefined,
          gasLimit:
            gasLimit !== undefined ? Number(BigInt(gasLimit)) : undefined,
        };
        await transactionHistoryStore.addTransaction(from, entry);
      } catch (error) {
        console.error(
          "QrlWeb3Wallet: Failed to record dApp transaction in history",
          error,
        );
      }
    };

    // Records the pending entry for either send path, from the
    // TransactionObject that was signed. Replacement fields (nonce and
    // fees) are carried only for a plain QRL transfer.
    // signAndSendReplacementTransaction (qrlStore.ts) decides whether an
    // entry it is speeding up/cancelling is a contract call solely from
    // `tokenContractAddress`, which every dApp entry leaves empty; giving a
    // contract call or deployment a nonce would make TransactionDetail's
    // Speed Up (canReplace) available for it and have that replacement
    // logic reconstruct a bare value transfer to `to` with the original
    // calldata attached, for an interaction, or to an empty `to` for a
    // deployment (no `to` is ever recorded for one). Withholding the nonce
    // keeps `canReplace` false for both, exactly as it was before this
    // broadcast-and-answer flow started recording dApp transactions at all.
    const recordPendingTransactionForRequest = async (
      transactionObject: TransactionObject,
      transactionHash: string,
      isQrlTransfer: boolean,
    ) => {
      await recordPendingTransaction({
        from: transactionObject.from,
        to: transactionObject.to,
        value: transactionObject.value,
        data: transactionObject.data,
        transactionHash,
        isQrlTransfer,
        nonce: isQrlTransfer ? transactionObject.nonce : undefined,
        maxFeePerGas:
          isQrlTransfer && transactionObject.type === "0x2"
            ? transactionObject.maxFeePerGas
            : undefined,
        maxPriorityFeePerGas:
          isQrlTransfer && transactionObject.type === "0x2"
            ? transactionObject.maxPriorityFeePerGas
            : undefined,
        gasLimit: isQrlTransfer ? transactionObject.gas : undefined,
      });
    };

    const deployContractOrInteract = async () => {
      const request = dAppRequestData?.params?.[0];
      // Hoisted above the try so the catch block can still record a pending
      // entry for a TransactionMayStillBeProcessingError (the broadcast
      // timeout case): a `const` declared inside `try` is not visible in
      // `catch`. Kept as a separate variable from the `const` below,
      // declared as plain TransactionObject, so every use inside the try
      // stays fully narrowed.
      let pendingTransactionObject: TransactionObject | undefined;
      try {
        const { from, to, data, gas, type, value } = request;

        const isLedgerAccount = ledgerStore.isLedgerAccount(from ?? "");

        const gasPrice = await qrlInstance?.getGasPrice();
        const transactionObject: TransactionObject = {
          chainId: V3_CHAIN_ID,
          from,
          ...(to && { to }),
          data,
          gas,
          value,
          nonce: await qrlInstance?.getTransactionCount(
            from,
            SIGNING_NONCE_BLOCK_TAG,
          ),
        };
        pendingTransactionObject = transactionObject;
        if (type === "0x2") {
          const { maxFeePerGas, maxPriorityFeePerGas } = await getGasFeeData();
          transactionObject.type = "0x2";
          transactionObject.maxPriorityFeePerGas = maxPriorityFeePerGas;
          transactionObject.maxFeePerGas = `0x${maxFeePerGas.toString(16)}`;
        } else {
          transactionObject.gasPrice = gasPrice;
        }

        let rawTransactionToSend: string | undefined;
        let precomputedHash: string | undefined;

        await ensureSigningContext();
        if (isLedgerAccount) {
          const common = Common.custom({
            chainId: Number(BigInt(V3_CHAIN_ID)),
          });

          const txData: Record<string, unknown> = {
            nonce: `0x${transactionObject.nonce?.toString(16)}`,
            gasLimit: transactionObject.gas,
            data: transactionObject.data || "0x",
            value: transactionObject.value
              ? `0x${BigInt(transactionObject.value).toString(16)}`
              : "0x0",
          };

          if (transactionObject.to) {
            txData.to = transactionObject.to;
          }

          if (transactionObject.type === "0x2") {
            txData.maxPriorityFeePerGas =
              transactionObject.maxPriorityFeePerGas;
            txData.maxFeePerGas = transactionObject.maxFeePerGas;
          } else {
            txData.gasPrice = `0x${BigInt(transactionObject.gasPrice ?? 0).toString(16)}`;
          }

          rawTransactionToSend = await ledgerStore.signAndSerializeTransaction(
            from ?? "",
            txData,
            common,
          );
          // The Ledger returns only the raw signed bytes; hash them
          // ourselves the same way signTransaction does for a mnemonic
          // account (sha3Raw of the raw transaction, see
          // @theqrl/web3-qrl-accounts' signTransaction).
          precomputedHash = rawTransactionToSend
            ? hashRawTransaction(rawTransactionToSend)
            : undefined;
        } else {
          // Regular account - use mnemonic-based signing
          const mnemonicPhrases = await getMnemonicPhrases(from ?? "");
          const seed = getHexSeedFromMnemonic(mnemonicPhrases);
          // Guard, as every other signing surface does: the seed must derive
          // the requested sender. Fails fast if `from` is a stale/removed
          // account (getMnemonicPhrases returns "") instead of feeding an
          // empty seed into signTransaction.
          const addressFromMnemonic =
            qrlInstance?.accounts.seedToAccount(seed)?.address;
          if (!areAddressesEquivalent(from, addressFromMnemonic)) {
            throw new Error(
              "Signing account does not match the requested sender",
            );
          }
          await ensureSigningContext();
          const signedTransaction = await qrlInstance?.accounts.signTransaction(
            transactionObject,
            seed,
          );
          rawTransactionToSend = signedTransaction?.rawTransaction;
          precomputedHash = signedTransaction?.transactionHash;
        }

        if (rawTransactionToSend && precomputedHash) {
          const transactionHash = await broadcastTransaction(
            rawTransactionToSend,
            transactionObject,
            precomputedHash,
          );
          addToResponseData({ transactionHash });
          await recordPendingTransactionForRequest(
            transactionObject,
            transactionHash,
            false,
          );
        } else {
          throw new Error("Transaction could not be signed");
        }
      } catch (error) {
        if (isWalletLockedError(error)) {
          // getMnemonicPhrases() hit the SW's locked-wallet guard (L1, PR
          // #71 audit): this surface's own isLocked belief was stale.
          // Force a re-check so ScreenLoader can swap to the lock screen,
          // show a translated message here too, and give the dApp a
          // stable EIP-1193 error; the raw guard text never reaches the
          // dApp response.
          setIsWalletLocked(true);
          void readLockState();
          addToResponseData({ error: walletLockedProviderError() });
          return;
        }
        if (error instanceof TransactionMayStillBeProcessingError) {
          addToResponseData({ error });
          if (pendingTransactionObject) {
            await recordPendingTransactionForRequest(
              pendingTransactionObject,
              error.transactionHash,
              false,
            );
          }
          return;
        }
        addToResponseData({ error });
        console.error(
          transactionType === SEND_TRANSACTION_TYPES.CONTRACT_DEPLOYMENT
            ? "Contract deployment failed:"
            : "Contract interaction failed:",
          error,
        );
      }
    };

    const sendZndTransfer = async () => {
      const request = dAppRequestData?.params?.[0];
      // Hoisted above the try for the same reason as in
      // deployContractOrInteract: the catch block needs it for a
      // TransactionMayStillBeProcessingError, and kept separate from the
      // `const` below, declared as plain TransactionObject, so every use
      // inside the try stays fully narrowed.
      let pendingTransactionObject: TransactionObject | undefined;
      try {
        const { from, to, gas, type, value } = request;

        if (!from) {
          throw new Error(
            "Sender address ('from') is missing for QRL transfer.",
          );
        }
        if (!to) {
          throw new Error(
            "Recipient address ('to') is missing for QRL transfer.",
          );
        }
        if (!gas) {
          throw new Error("Gas limit ('gas') is missing for QRL transfer.");
        }
        if (value === undefined || value === null) {
          throw new Error(
            "Transfer amount ('value') is missing for QRL transfer.",
          );
        }

        const isLedgerAccount = ledgerStore.isLedgerAccount(from);

        const gasPrice = await qrlInstance?.getGasPrice();
        const transactionObject: TransactionObject = {
          chainId: V3_CHAIN_ID,
          from,
          to,
          gas,
          value,
          nonce: await qrlInstance?.getTransactionCount(
            from,
            SIGNING_NONCE_BLOCK_TAG,
          ),
        };
        pendingTransactionObject = transactionObject;

        if (type === "0x2") {
          const { maxFeePerGas, maxPriorityFeePerGas } = await getGasFeeData();
          transactionObject.type = "0x2";
          transactionObject.maxPriorityFeePerGas = maxPriorityFeePerGas;
          transactionObject.maxFeePerGas = `0x${maxFeePerGas.toString(16)}`;
        } else {
          transactionObject.gasPrice = gasPrice;
        }

        let rawTransactionToSend: string | undefined;
        let precomputedHash: string | undefined;

        await ensureSigningContext();
        if (isLedgerAccount) {
          const common = Common.custom({
            chainId: Number(BigInt(V3_CHAIN_ID)),
          });

          const txData = {
            nonce: `0x${transactionObject.nonce?.toString(16)}`,
            maxPriorityFeePerGas: transactionObject.maxPriorityFeePerGas,
            maxFeePerGas: transactionObject.maxFeePerGas,
            gasLimit: transactionObject.gas,
            to: transactionObject.to,
            value: `0x${BigInt(transactionObject.value ?? 0).toString(16)}`,
            data: "0x",
          };

          rawTransactionToSend = await ledgerStore.signAndSerializeTransaction(
            from,
            txData,
            common,
          );
          // See deployContractOrInteract: the Ledger path has no
          // signTransaction result to read a hash from, so it is derived
          // from the raw bytes the same way signTransaction computes one.
          precomputedHash = rawTransactionToSend
            ? hashRawTransaction(rawTransactionToSend)
            : undefined;
        } else {
          // Regular account - use mnemonic-based signing
          const mnemonicPhrases = await getMnemonicPhrases(from ?? "");
          const seed = getHexSeedFromMnemonic(mnemonicPhrases);
          // Guard, as every other signing surface does: the seed must derive
          // the requested sender. Fails fast if `from` is a stale/removed
          // account (getMnemonicPhrases returns "") instead of feeding an
          // empty seed into signTransaction.
          const addressFromMnemonic =
            qrlInstance?.accounts.seedToAccount(seed)?.address;
          if (!areAddressesEquivalent(from, addressFromMnemonic)) {
            throw new Error(
              "Signing account does not match the requested sender",
            );
          }
          await ensureSigningContext();
          const signedTransaction = await qrlInstance?.accounts.signTransaction(
            transactionObject,
            seed,
          );
          rawTransactionToSend = signedTransaction?.rawTransaction;
          precomputedHash = signedTransaction?.transactionHash;
        }

        if (rawTransactionToSend && precomputedHash) {
          const transactionHash = await broadcastTransaction(
            rawTransactionToSend,
            transactionObject,
            precomputedHash,
          );
          addToResponseData({ transactionHash });
          await recordPendingTransactionForRequest(
            transactionObject,
            transactionHash,
            true,
          );
        } else {
          throw new Error("QRL Transfer transaction could not be signed");
        }
      } catch (error) {
        if (isWalletLockedError(error)) {
          // getMnemonicPhrases() hit the SW's locked-wallet guard (L1, PR
          // #71 audit): this surface's own isLocked belief was stale.
          // Force a re-check so ScreenLoader can swap to the lock screen,
          // show a translated message here too, and give the dApp a
          // stable EIP-1193 error; the raw guard text never reaches the
          // dApp response.
          setIsWalletLocked(true);
          void readLockState();
          addToResponseData({ error: walletLockedProviderError() });
          return;
        }
        if (error instanceof TransactionMayStillBeProcessingError) {
          addToResponseData({ error });
          if (pendingTransactionObject) {
            await recordPendingTransactionForRequest(
              pendingTransactionObject,
              error.transactionHash,
              true,
            );
          }
          return;
        }
        addToResponseData({ error });
        console.error("QRL Transfer failed:", error);
      }
    };
    useEffect(() => {
      setCanProceed(true);
    }, []);

    return (
      <Tabs defaultValue="details" className="w-full">
        {isWalletLocked && (
          <div className="mb-2 rounded border border-red-500/60 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300">
            {t("account.walletLockedError")}
          </div>
        )}
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger
            value="details"
            className="w-full data-[state=active]:text-secondary"
          >
            {t("dapp.sendTransaction.tabDetails")}
          </TabsTrigger>
          {transactionType !== SEND_TRANSACTION_TYPES.QRL_TRANSFER && (
            <TabsTrigger
              value="data"
              className="w-full data-[state=active]:text-secondary"
            >
              {t("dapp.sendTransaction.tabData")}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="details" className="rounded-md p-2">
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <div>{t("dapp.sendTransaction.fromAddress")}</div>
              <FullAddress
                address={accountFromAddress}
                className="w-full font-bold text-identity-accent"
              />
            </div>
            {(transactionType === SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION ||
              transactionType === SEND_TRANSACTION_TYPES.QRL_TRANSFER) && (
              <div className="flex flex-col gap-1">
                <div>
                  {transactionType ===
                  SEND_TRANSACTION_TYPES.CONTRACT_INTERACTION
                    ? t("dapp.sendTransaction.contractAddress")
                    : t("dapp.sendTransaction.toAddress")}
                </div>
                <FullAddress
                  address={accountToAddress}
                  className="w-full font-bold text-identity-accent"
                />
              </div>
            )}
            {(transactionType === SEND_TRANSACTION_TYPES.QRL_TRANSFER ||
              value > 0n) && (
              <div className="flex flex-col gap-1">
                <div>{t("dapp.sendTransaction.value")}</div>
                <div className="font-numeric font-bold text-secondary">
                  {utils.fromPlanck(value, "quanta")} Quanta
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <div>{t("dapp.sendTransaction.gasLimit")}</div>
              <div className="font-numeric font-bold text-secondary">
                {gasLimit.toString()}
              </div>
            </div>
          </div>
        </TabsContent>
        {transactionType !== SEND_TRANSACTION_TYPES.QRL_TRANSFER && (
          <TabsContent value="data" className="rounded-md p-2">
            <div className="flex flex-col gap-1">
              <div>{t("dapp.sendTransaction.data")}</div>
              <div className="flex gap-2">
                <div className="max-h-[8rem] w-full overflow-auto break-words font-bold text-secondary">
                  {data}
                </div>
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      className="h-7 w-8 hover:text-secondary"
                      variant="outline"
                      size="icon"
                      onClick={copyData}
                    >
                      <Copy size="16" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    <Label>{t("dapp.sendTransaction.copyData")}</Label>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>
    );
  },
);

export default QrlSendTransactionForContent;
