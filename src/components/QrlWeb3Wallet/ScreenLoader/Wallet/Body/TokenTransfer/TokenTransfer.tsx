import { Button } from "@/components/UI/Button";
import AddressDisclosure from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/AddressDisclosure";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/UI/Card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/UI/Form";
import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import { Slider } from "@/components/UI/Slider";
import { NATIVE_TOKEN } from "@/constants/nativeToken";
import { SIGNING_NONCE_BLOCK_TAG } from "@/constants/transactionNonce";
import { isWalletLockedError } from "@/functions/describeExtensionError";
import { formatFiatCompact } from "@/functions/formatFiat";
import { getOptimalTokenBalance } from "@/functions/getOptimalTokenBalance";
import { parseBalanceValue } from "@/functions/parseBalanceValue";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import { isCanonicalQrlAddress, isQrlAddress } from "@/utilities/addressUtil";
import StorageUtil from "@/utilities/storageUtil";
import { isQrnsName, resolveQrnsName } from "@/utilities/qrnsResolver";
import { zodResolver } from "@hookform/resolvers/zod";
import { utils, qrl } from "@theqrl/web3";
import { BigNumber } from "bignumber.js";
import { Loader, Send, X } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { z } from "zod";
import type { GasFeeOverrides } from "@/types/gasFee";
import BackButton from "../../../Shared/BackButton/BackButton";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";
import StaleBalanceNotice from "../../../Shared/StaleBalanceNotice/StaleBalanceNotice";
import AccountAddressSection from "./AccountAddressSection/AccountAddressSection";
import { GasFeeSelector } from "./GasFeeNotice/GasFeeSelector";
import RecipientPicker from "./RecipientPicker/RecipientPicker";
import TokenDisplaySection from "./TokenDisplaySection/TokenDisplaySection";
import { NATIVE_TOKEN_UNITS_OF_GAS } from "@/constants/nativeToken";
import { toTokenBaseUnits } from "@/functions/tokenAmount";
import { transactionFailureUpdate } from "@/functions/transactionOutcome";

const { Common } = qrl.accounts;

function amountForDisplay(value: string): BigNumber {
  return new BigNumber(/^(?:\d+\.?\d*|\.\d+)$/.test(value) ? value : "0");
}

const createFormSchema = (t: TFunction, decimals: number) =>
  z
    .object({
      receiverAddress: z.string().min(1, t("validation.receiverRequired")),
      amount: z
        .string()
        // A comma decimal separator is the single most common way to fail
        // the pattern below, and "Amount should be more than 0" told the
        // user nothing about it. Named before the generic check.
        .refine(
          (value) => !value.includes(","),
          t("validation.amountCommaSeparator"),
        )
        .refine(
          (value) =>
            /^(?:\d+\.?\d*|\.\d+)$/.test(value) && new BigNumber(value).gt(0),
          t("validation.amountPositive"),
        )
        // Checked while the user types. toTokenBaseUnits throws on a
        // value with more decimal places than the token has, which used to
        // surface as a raw exception in the error banner after the user had
        // already pressed Send.
        .refine(
          (value) => {
            if (!/^(?:\d+\.?\d*|\.\d+)$/.test(value)) return true;
            try {
              toTokenBaseUnits(value, decimals);
              return true;
            } catch {
              return false;
            }
          },
          t("validation.amountTooManyDecimals", { decimals }),
        ),
    })
    .refine(
      (fields) =>
        isQrlAddress(fields.receiverAddress) ||
        isQrnsName(fields.receiverAddress),
      {
        message: t("validation.addressInvalid"),
        path: ["receiverAddress"],
      },
    );

type TransferTokenDetails = {
  isZrc20Token: boolean;
  tokenContractAddress: string;
  tokenDecimals: number;
  tokenImage: string;
  tokenBalance: string;
  tokenBalanceBaseUnits?: string;
  tokenName: string;
  tokenSymbol: string;
};

const TokenTransfer = observer(() => {
  const { t } = useTranslation();
  const { state } = useLocation();
  const navigate = useNavigate();
  const {
    lockStore,
    qrlStore,
    ledgerStore,
    transactionHistoryStore,
    priceStore,
    settingsStore,
  } = useStore();
  // Quoted in the user's currency where there is a usable quote for it, in
  // dollars otherwise, so the number and its symbol always agree.
  const amountQuote = priceStore.quoteFor(settingsStore.currency);
  const { getMnemonicPhrases } = lockStore;
  const {
    activeAccount,
    signNativeToken,
    fetchAccounts,
    signZrc20Token,
    sendRawTransaction,
    qrlInstance,
    getGasFeeData,
    getNativeTokenGas,
    getAccountBalance,
    getZrc20TokenDetails,
  } = qrlStore;
  const { accountAddress } = activeAccount;

  const [isZrc20Token, setIsZrc20Token] = useState(false);
  const [tokenContractAddress, setTokenContractAddress] = useState("");
  const [tokenDecimals, setTokenDecimals] = useState(0);
  const [tokenImage, setTokenImage] = useState(NATIVE_TOKEN.image);
  const [tokenBalance, setTokenBalance] = useState("");
  // Exact on-chain integer balance for the selected ZRC-20. Every guard
  // and the Max button work off this; `tokenBalance` above is the
  // 4-decimal display string, for display.
  const [tokenBalanceBaseUnits, setTokenBalanceBaseUnits] = useState("");
  const [tokenName, setTokenName] = useState(NATIVE_TOKEN.name);
  const [tokenSymbol, setTokenSymbol] = useState(NATIVE_TOKEN.symbol);
  const [estimatedGasFee, setEstimatedGasFee] = useState("");
  const [nativeGasReserve, setNativeGasReserve] = useState("0");
  const [sliderValue, setSliderValue] = useState(0);
  const [balanceError, setBalanceError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [gasFeeOverrides, setGasFeeOverrides] = useState<
    GasFeeOverrides | undefined
  >();
  const [resolvedQrns, setResolvedQrns] = useState<{
    name: string;
    chainId: string;
    rpcUrl: string;
    registryAddress: string;
    address: string;
  } | null>(null);
  const [qrnsResolving, setQrnsResolving] = useState(false);
  const [qrnsError, setQrnsError] = useState<string | null>(null);
  const [gasEstimateError, setGasEstimateError] = useState("");

  const amountDecimals = isZrc20Token ? tokenDecimals : 18;
  const FormSchema = createFormSchema(t, amountDecimals);

  type SignResult = {
    transactionHash?: string;
    rawTransaction?: string;
    error: string;
    nonce?: number;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    gasLimit?: number;
    data?: string;
  };

  const signNativeTokenLocal = async (
    formData: z.infer<typeof FormSchema>,
  ): Promise<SignResult> => {
    const isLedgerAccount = ledgerStore.isLedgerAccount(accountAddress);
    if (isLedgerAccount) {
      return await signNativeTokenWithLedger(formData);
    } else {
      const mnemonicPhrases = await getMnemonicPhrases(accountAddress);
      return await signNativeToken(
        accountAddress,
        formData.receiverAddress,
        formData.amount,
        mnemonicPhrases,
        gasFeeOverrides,
      );
    }
  };

  const signNativeTokenWithLedger = async (
    formData: z.infer<typeof FormSchema>,
  ): Promise<SignResult> => {
    let result: SignResult = { error: "" };

    try {
      const { maxFeePerGas, maxPriorityFeePerGas } =
        await getGasFeeData(gasFeeOverrides);
      const gasLimit =
        gasFeeOverrides?.tier === "advanced" && gasFeeOverrides.gasLimit
          ? gasFeeOverrides.gasLimit
          : NATIVE_TOKEN_UNITS_OF_GAS;
      const nonce = await qrlInstance?.getTransactionCount(
        accountAddress,
        SIGNING_NONCE_BLOCK_TAG,
      );
      const chainId = await qrlInstance?.getChainId();

      const common = Common.custom({ chainId: Number(chainId) });
      const txData = {
        nonce: `0x${(nonce ?? 0).toString(16)}`,
        maxPriorityFeePerGas: `0x${Number(maxPriorityFeePerGas).toString(16)}`,
        maxFeePerGas: `0x${Number(maxFeePerGas).toString(16)}`,
        gasLimit: `0x${BigInt(gasLimit).toString(16)}`,
        to: formData.receiverAddress,
        value: `0x${toTokenBaseUnits(formData.amount, 18).toString(16)}`,
        data: "0x",
      };

      const signedRawTxHex = await ledgerStore.signAndSerializeTransaction(
        accountAddress,
        txData,
        common,
      );
      const transactionHash = utils.sha3(signedRawTxHex);

      result = {
        transactionHash: transactionHash?.toString(),
        rawTransaction: signedRawTxHex,
        error: "",
        nonce: Number(nonce),
        maxFeePerGas: maxFeePerGas.toString(),
        maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
        gasLimit,
      };
    } catch (error) {
      console.error("[TokenTransfer] Ledger signing failed:", error);
      result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
  };

  const signZrc20TokenLocal = async (
    formData: z.infer<typeof FormSchema>,
  ): Promise<SignResult> => {
    if (ledgerStore.isLedgerAccount(accountAddress)) {
      // The device app has no contract-call signing path yet, and without
      // this the flow fell through to an empty key and failed with a
      // generic "could not be signed" message.
      return { error: t("transfer.errorLedgerTokenUnsupported") };
    }
    const mnemonicPhrases = await getMnemonicPhrases(accountAddress);
    return await signZrc20Token(
      accountAddress,
      formData.receiverAddress,
      formData.amount,
      mnemonicPhrases,
      tokenContractAddress,
      tokenDecimals,
      gasFeeOverrides,
    );
  };

  async function onSubmit(formData: z.infer<typeof FormSchema>) {
    try {
      if (isQrnsName(formData.receiverAddress)) {
        if (!resolvedAddress) {
          control.setError("receiverAddress", {
            message: t("transfer.qrnsResolutionFailed"),
          });
          return;
        }
        formData = { ...formData, receiverAddress: resolvedAddress };
      }

      // Step 1: Sign the transaction (fast, no blockchain wait)
      let signResult: SignResult;
      if (isZrc20Token) {
        signResult = await signZrc20TokenLocal(formData);
      } else {
        signResult = await signNativeTokenLocal(formData);
      }

      const {
        transactionHash,
        rawTransaction,
        error,
        nonce,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasLimit,
        data,
      } = signResult;

      if (error) {
        control.setError("amount", {
          message: t("transfer.errorOccurred", { error }),
        });
        return;
      }

      if (!transactionHash || !rawTransaction) {
        control.setError("amount", {
          message: t("transfer.errorFailed"),
        });
        return;
      }

      // Step 2: Save as "pending" in transaction history
      const { chainId } = await StorageUtil.getActiveBlockChain();
      const historyEntry: TransactionHistoryEntry = {
        id: transactionHash,
        from: accountAddress,
        to: formData.receiverAddress,
        amount: formData.amount,
        tokenSymbol,
        tokenName,
        isZrc20Token,
        tokenContractAddress,
        tokenDecimals,
        transactionHash,
        blockNumber: "",
        gasUsed: "",
        effectiveGasPrice: "",
        status: false,
        timestamp: Date.now(),
        chainId,
        pendingStatus: "pending",
        nonce,
        maxFeePerGas,
        maxPriorityFeePerGas,
        gasLimit,
        data,
      };
      await transactionHistoryStore.addTransaction(
        accountAddress,
        historyEntry,
      );

      // Step 3: Broadcast in background, do not await
      sendRawTransaction(rawTransaction).then(
        async (receipt) => {
          const update = transactionFailureUpdate({ receipt }, transactionHash);
          if (update.receiptStatusVerified) {
            await transactionHistoryStore.updateTransaction(
              accountAddress,
              transactionHash,
              update,
            );
            await fetchAccounts();
          }
        },
        async (err) => {
          console.error("[TokenTransfer] Broadcast failed:", err);
          await transactionHistoryStore.updateTransaction(
            accountAddress,
            transactionHash,
            transactionFailureUpdate(err, transactionHash),
          );
        },
      );

      // Step 4: Navigate home immediately, TX is visible as "pending" in history
      await resetForm();
      navigate(ROUTES.TRANSACTION_HISTORY);
    } catch (error) {
      if (isWalletLockedError(error)) {
        // The SW's decrypted keys and this surface's own isLocked belief
        // can fall out of sync for a moment (M2); this signing attempt
        // hit the real, locked state. Push the screen to the lock view
        // immediately: the dashboard would otherwise stay up with a form
        // that can only fail again (L4).
        void lockStore.readLockState();
        control.setError("amount", {
          message: t("account.walletLockedError"),
        });
        return;
      }
      control.setError("amount", {
        message: t("transfer.errorOccurred", { error }),
      });
    }
  }

  const resetForm = async () => {
    await StorageUtil.clearTransactionValues();
    setSliderValue(0);
    reset({ receiverAddress: "", amount: "" });
  };

  const cancelTransaction = () => {
    resetForm();
    navigate(ROUTES.HOME);
  };

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: async () => {
      const storedTransactionValues = await StorageUtil.getTransactionValues();
      return {
        amount:
          storedTransactionValues?.amount &&
          new BigNumber(String(storedTransactionValues.amount)).gt(0)
            ? new BigNumber(String(storedTransactionValues.amount)).toFixed()
            : "",
        receiverAddress: storedTransactionValues?.receiverAddress ?? "",
      };
    },
  });
  const {
    reset,
    handleSubmit,
    control,
    watch,
    formState: { isSubmitting, isValid },
  } = form;

  useEffect(() => {
    (async () => {
      const shouldStartFresh = state?.shouldStartFresh;
      if (shouldStartFresh) {
        await resetForm();
      } else {
        const storedTransactionValues =
          await StorageUtil.getTransactionValues();
        const tokenDetailsFromStorage = storedTransactionValues?.tokenDetails;
        const tokenDetailsFromState = state?.tokenDetails;
        let tokenDetails: TransferTokenDetails = {
          isZrc20Token,
          tokenContractAddress,
          tokenDecimals,
          tokenImage,
          tokenBalance,
          tokenBalanceBaseUnits,
          tokenName,
          tokenSymbol,
        };

        if (tokenDetailsFromState) {
          await resetForm();
          setIsZrc20Token(tokenDetailsFromState?.isZrc20Token);
          setTokenContractAddress(tokenDetailsFromState?.tokenContractAddress);
          setTokenDecimals(tokenDetailsFromState?.tokenDecimals);
          setTokenImage(tokenDetailsFromState?.tokenImage);
          setTokenBalance(tokenDetailsFromState?.tokenBalance);
          setTokenBalanceBaseUnits(
            tokenDetailsFromState?.tokenBalanceBaseUnits ?? "",
          );
          setTokenName(tokenDetailsFromState?.tokenName);
          setTokenSymbol(tokenDetailsFromState?.tokenSymbol);
          tokenDetails = { ...tokenDetailsFromState };
        } else if (tokenDetailsFromStorage) {
          setIsZrc20Token(tokenDetailsFromStorage?.isZrc20Token ?? false);
          setTokenContractAddress(
            tokenDetailsFromStorage?.tokenContractAddress,
          );
          setTokenDecimals(tokenDetailsFromStorage?.tokenDecimals);
          setTokenImage(tokenDetailsFromStorage?.tokenImage);
          setTokenBalance(tokenDetailsFromStorage?.tokenBalance);
          setTokenBalanceBaseUnits(
            tokenDetailsFromStorage?.tokenBalanceBaseUnits ?? "",
          );
          setTokenName(tokenDetailsFromStorage?.tokenName);
          setTokenSymbol(tokenDetailsFromStorage?.tokenSymbol);
          tokenDetails = { ...tokenDetailsFromStorage };
        }

        await StorageUtil.setTransactionValues({
          amount: watch().amount,
          receiverAddress: watch().receiverAddress,
          tokenDetails,
        });
      }
    })();
  }, []);

  // A cold open restores the token balance straight from storage, where it
  // can be hours old. A ceiling that is too high passes the guard below and
  // then reverts on chain, burning the whole fee for nothing, so the live
  // balance is re-read here and overwrites both the display string and the
  // base-unit ceiling every guard and Max work from.
  useEffect(() => {
    if (!isZrc20Token || !tokenContractAddress || !accountAddress) return;
    let cancelled = false;
    (async () => {
      const details = await getZrc20TokenDetails(tokenContractAddress);
      if (cancelled || details.error || !details.token) return;
      setTokenBalance(
        getOptimalTokenBalance(
          details.token.balance.toString(),
          details.token.symbol,
        ),
      );
      setTokenBalanceBaseUnits(details.token.balanceBaseUnits);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    isZrc20Token,
    tokenContractAddress,
    accountAddress,
    getZrc20TokenDetails,
  ]);

  useEffect(() => {
    const formWatchSubscription = watch(async (value) => {
      await StorageUtil.setTransactionValues({
        ...value,
        tokenDetails: {
          isZrc20Token,
          tokenContractAddress,
          tokenDecimals,
          tokenImage,
          tokenBalance,
          tokenBalanceBaseUnits,
          tokenName,
          tokenSymbol,
        },
      });
    });
    return () => formWatchSubscription.unsubscribe();
  }, [
    watch,
    isZrc20Token,
    tokenContractAddress,
    tokenDecimals,
    tokenImage,
    tokenBalance,
    tokenBalanceBaseUnits,
    tokenName,
    tokenSymbol,
  ]);

  const watchedAmount = watch("amount");
  useEffect(() => {
    if (!watchedAmount || !amountForDisplay(watchedAmount).gt(0)) {
      setBalanceError("");
      return;
    }

    const sendAmount = amountForDisplay(watchedAmount);
    const nativeBalance = parseBalanceValue(getAccountBalance(accountAddress));

    if (isZrc20Token) {
      // Compared in base units: the display balance is rounded to four
      // decimals, so a real balance of 0.00005 of an 8-decimal token read
      // as 0 and every send of it was refused.
      if (tokenBalanceBaseUnits) {
        let requested: bigint | undefined;
        try {
          requested = toTokenBaseUnits(watchedAmount, tokenDecimals);
        } catch {
          // More decimal places than the token has; the schema reports it.
          requested = undefined;
        }
        if (
          requested !== undefined &&
          requested > BigInt(tokenBalanceBaseUnits)
        ) {
          setBalanceError(
            t("transfer.errorInsufficientToken", { tokenSymbol }),
          );
          return;
        }
      } else if (sendAmount.greaterThan(parseBalanceValue(tokenBalance))) {
        setBalanceError(t("transfer.errorInsufficientToken", { tokenSymbol }));
        return;
      }
      // The fee is spent from the native balance, so it is only checked
      // once an estimate exists.
      if (
        estimatedGasFee &&
        new BigNumber(estimatedGasFee).greaterThan(nativeBalance)
      ) {
        setBalanceError(t("transfer.errorInsufficientGas"));
        return;
      }
    } else {
      if (!estimatedGasFee) {
        setBalanceError("");
        return;
      }
      const totalCost = sendAmount.plus(new BigNumber(estimatedGasFee));
      if (totalCost.greaterThan(nativeBalance)) {
        setBalanceError(t("transfer.errorInsufficientBalance"));
        return;
      }
    }

    setBalanceError("");
  }, [
    watchedAmount,
    estimatedGasFee,
    tokenBalance,
    tokenBalanceBaseUnits,
    tokenDecimals,
    isZrc20Token,
    accountAddress,
  ]);

  // Worst-case gas reserve for native transfers so the slider's Max can
  // never pick a value that leaves nothing for gas. Unlike the selector's
  // estimate this needs no recipient/amount, so Max works on a blank form.
  // Recomputed when the tier changes (advanced overrides move the limit).
  useEffect(() => {
    if (isZrc20Token) {
      setNativeGasReserve("0");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const fee = await getNativeTokenGas(gasFeeOverrides);
        if (!cancelled) setNativeGasReserve(fee || "0");
      } catch {
        if (!cancelled) setNativeGasReserve("0");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isZrc20Token, gasFeeOverrides, getNativeTokenGas]);

  // Balance available for the amount itself. Tokens spend gas from the
  // native balance, so their full token balance is sendable.
  const maxSendable = useMemo(() => {
    if (isZrc20Token) {
      // Exact, so Max spends the whole balance. The rounded display
      // value used to leave dust behind. shift moves the decimal point by
      // exact multiplication, which no rounding setting can truncate;
      // division obeys the global DECIMAL_PLACES of 18 with ROUND_DOWN, so
      // a token with more than 18 decimals lost its tail and Max left dust
      // behind again.
      if (tokenBalanceBaseUnits) {
        return new BigNumber(tokenBalanceBaseUnits).shift(-tokenDecimals);
      }
      return parseBalanceValue(tokenBalance);
    }
    const balance = parseBalanceValue(getAccountBalance(accountAddress));
    const reserve = new BigNumber(nativeGasReserve || "0");
    const sendable = balance.minus(reserve);
    return sendable.gt(0) ? sendable : new BigNumber(0);
  }, [
    isZrc20Token,
    tokenBalance,
    tokenBalanceBaseUnits,
    tokenDecimals,
    accountAddress,
    nativeGasReserve,
    getAccountBalance,
  ]);

  const applyPercentage = (percentage: number) => {
    setSliderValue(percentage);
    if (maxSendable.isZero()) {
      form.setValue("amount", "", { shouldValidate: true });
      return;
    }
    const decimals = isZrc20Token ? tokenDecimals : 18;
    const formatted = maxSendable
      .times(percentage)
      .times("0.01")
      .round(
        percentage === 100 ? decimals : Math.min(6, decimals),
        BigNumber.ROUND_DOWN,
      )
      .toFixed();
    form.setValue("amount", formatted, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  // Max is a percentage of a balance that moves: raising the gas tier
  // raises the reserve, so the amount picked under the old, cheaper tier is
  // no longer sendable. Re-applied while the slider still sits at 100%.
  const applyPercentageRef = useRef(applyPercentage);
  applyPercentageRef.current = applyPercentage;
  useEffect(() => {
    if (sliderValue !== 100 || isZrc20Token) return;
    applyPercentageRef.current(100);
  }, [nativeGasReserve, isZrc20Token]);

  // Typing an amount moves the slider to match.
  useEffect(() => {
    const amountNumber = amountForDisplay(watchedAmount || "0");
    if (
      !amountNumber.isFinite() ||
      !amountNumber.gt(0) ||
      maxSendable.isZero()
    ) {
      setSliderValue(0);
      return;
    }
    const percentage = BigNumber.min(
      amountNumber.dividedBy(maxSendable).times(100),
      100,
    )
      .round(0, BigNumber.ROUND_HALF_UP)
      .toNumber();
    setSliderValue(percentage);
  }, [watchedAmount, maxSendable]);

  const watchedReceiver = watch("receiverAddress");
  const qrnsBlockchain = qrlStore.qrlConnection.blockchain;
  const qrnsChainId = qrnsBlockchain.chainId;
  const qrnsRpcUrl = qrnsBlockchain.defaultRpcUrl;
  const qrnsRegistryAddress = qrnsBlockchain.qrnsRegistryAddress;
  const resolvedAddress =
    resolvedQrns &&
    resolvedQrns.name === watchedReceiver &&
    resolvedQrns.chainId === qrnsChainId &&
    resolvedQrns.rpcUrl === qrnsRpcUrl &&
    resolvedQrns.registryAddress === qrnsRegistryAddress
      ? resolvedQrns.address
      : null;
  const transactionReceiver = isQrnsName(watchedReceiver)
    ? (resolvedAddress ?? "")
    : watchedReceiver;
  const resolveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(resolveTimerRef.current);
    let cancelled = false;

    if (!watchedReceiver || !isQrnsName(watchedReceiver)) {
      setResolvedQrns(null);
      setQrnsError(null);
      setQrnsResolving(false);
      return () => {
        cancelled = true;
      };
    }

    setResolvedQrns(null);
    if (!isCanonicalQrlAddress(qrnsRegistryAddress)) {
      setQrnsError(t("transfer.qrnsUnavailable"));
      setQrnsResolving(false);
      return () => {
        cancelled = true;
      };
    }

    setQrnsError(null);
    setQrnsResolving(true);
    const nameToResolve = watchedReceiver;

    resolveTimerRef.current = setTimeout(() => {
      resolveQrnsName(nameToResolve, qrnsBlockchain)
        .then((addr) => {
          if (cancelled) return;
          setResolvedQrns({
            name: nameToResolve,
            chainId: qrnsChainId,
            rpcUrl: qrnsRpcUrl,
            registryAddress: qrnsRegistryAddress,
            address: addr,
          });
          setQrnsError(null);
        })
        .catch(() => {
          if (cancelled) return;
          setResolvedQrns(null);
          setQrnsError(t("transfer.qrnsResolutionFailed"));
        })
        .finally(() => {
          if (!cancelled) setQrnsResolving(false);
        });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(resolveTimerRef.current);
    };
  }, [
    watchedReceiver,
    qrnsBlockchain,
    qrnsChainId,
    qrnsRpcUrl,
    qrnsRegistryAddress,
    t,
  ]);

  return (
    <Form {...form}>
      <form className="w-full" onSubmit={handleSubmit(onSubmit)}>
        <CircuitBackground />
        <div className="page-enter relative z-10 p-8">
          <BackButton />
          <Card className="w-full">
            <CardHeader className="flex flex-col gap-4 pb-4">
              <TokenDisplaySection
                tokenImage={tokenImage}
                tokenName={tokenName}
                tokenSymbol={tokenSymbol}
              />
            </CardHeader>
            <CardContent className="flex flex-col gap-8 pt-6">
              <div className="flex flex-col gap-1">
                <Label className="text-lg">{t("transfer.activeAccount")}</Label>
                <AccountAddressSection tokenBalance={tokenBalance} />
                <StaleBalanceNotice />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-lg">
                  {t("transfer.makeTransaction")}
                </Label>
                <div className="flex flex-col gap-4">
                  <FormField
                    control={control}
                    name="receiverAddress"
                    render={({ field }) => (
                      <FormItem>
                        <Label>{t("transfer.sendTo")}</Label>
                        <div className="flex items-center gap-1">
                          <FormControl>
                            <Input
                              {...field}
                              aria-label={field.name}
                              autoComplete="off"
                              disabled={isSubmitting}
                              placeholder={t("transfer.receiverPlaceholder")}
                            />
                          </FormControl>
                          <RecipientPicker
                            open={pickerOpen}
                            onOpenChange={setPickerOpen}
                            onSelect={(address) => {
                              form.setValue("receiverAddress", address, {
                                shouldValidate: true,
                              });
                            }}
                          />
                        </div>
                        <FormDescription>
                          {t("transfer.receiverDescription")}
                        </FormDescription>
                        {qrnsResolving && (
                          <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader className="h-3 w-3 animate-spin" />
                            {t("transfer.qrnsResolving")}
                          </p>
                        )}
                        {resolvedAddress && !qrnsResolving && (
                          <div className="rounded-md border border-success/20 bg-success/5 p-2 text-success">
                            <p className="mb-1 text-xs font-medium">
                              {t("transfer.qrnsResolved")}
                            </p>
                            <AddressDisclosure
                              key={resolvedAddress}
                              address={resolvedAddress}
                              fingerprintClassName="text-success"
                              fullAddressClassName="text-success"
                            />
                          </div>
                        )}
                        {qrnsError && !qrnsResolving && (
                          <p className="text-xs text-destructive">
                            {qrnsError}
                          </p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <Label>{t("transfer.amountLabel")}</Label>
                        <div className="relative">
                          <FormControl>
                            <Input
                              {...field}
                              aria-label={field.name}
                              autoComplete="off"
                              className="pr-28"
                              disabled={isSubmitting}
                              placeholder={t("transfer.amountPlaceholder")}
                              type="text"
                              inputMode="decimal"
                              onWheel={(e) =>
                                (e.target as HTMLInputElement).blur()
                              }
                            />
                          </FormControl>
                          <span
                            className="pointer-events-none absolute right-3 top-1/2 max-w-24 -translate-y-1/2 truncate text-sm text-muted-foreground"
                            title={tokenSymbol}
                          >
                            {tokenSymbol}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-col gap-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              {t("transfer.percentOfBalance")}
                            </span>
                            <span className="font-numeric text-xs text-muted-foreground">
                              {sliderValue}%
                            </span>
                          </div>
                          <Slider
                            // Radix renders a hidden input per thumb inside
                            // the surrounding form, so it needs a name.
                            name="amountPercentOfBalance"
                            aria-label={t("transfer.percentOfBalance")}
                            value={[sliderValue]}
                            min={0}
                            max={100}
                            step={1}
                            disabled={isSubmitting}
                            onValueChange={(value) =>
                              applyPercentage(value[0] ?? 0)
                            }
                          />
                          <div className="flex gap-2">
                            {[25, 50, 75, 100].map((percentage) => (
                              <Button
                                key={percentage}
                                className="flex-1"
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isSubmitting}
                                onClick={() => applyPercentage(percentage)}
                              >
                                {percentage === 100
                                  ? t("transfer.max")
                                  : `${percentage}%`}
                              </Button>
                            ))}
                          </div>
                        </div>

                        <FormDescription>
                          {t("transfer.amountDescription")}
                          {!isZrc20Token &&
                            settingsStore.showBalanceAndPrice &&
                            amountQuote.price > 0 &&
                            amountForDisplay(field.value || "0").gt(0) && (
                              <span className="ml-1 font-numeric text-muted-foreground">
                                {formatFiatCompact(
                                  field.value,
                                  amountQuote.price,
                                  amountQuote.currency,
                                )}
                              </span>
                            )}
                        </FormDescription>
                        <FormMessage />
                        {balanceError && (
                          <p className="text-sm font-medium text-destructive">
                            {balanceError}
                          </p>
                        )}
                      </FormItem>
                    )}
                  />
                  <GasFeeSelector
                    isZrc20Token={isZrc20Token}
                    tokenContractAddress={tokenContractAddress}
                    tokenDecimals={tokenDecimals}
                    from={accountAddress}
                    to={transactionReceiver}
                    value={watch().amount}
                    disabled={isSubmitting}
                    onOverridesChange={setGasFeeOverrides}
                    onGasFeeCalculated={setEstimatedGasFee}
                    onEstimateError={setGasEstimateError}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="gap-4">
              <Button
                className="w-full min-w-0"
                type="button"
                variant="outline"
                onClick={() => cancelTransaction()}
              >
                <X className="mr-2 h-4 w-4 shrink-0" />
                {t("transfer.cancelButton")}
              </Button>
              <Button
                disabled={
                  isSubmitting ||
                  !isValid ||
                  !!balanceError ||
                  !!gasEstimateError ||
                  qrnsResolving ||
                  (isQrnsName(watchedReceiver) && !resolvedAddress)
                }
                className="w-full min-w-0"
              >
                {isSubmitting ? (
                  <Loader className="mr-2 h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4 shrink-0" />
                )}
                <span className="truncate">
                  {isSubmitting
                    ? t("transfer.sendingButton", { tokenSymbol })
                    : t("transfer.sendButton", { tokenSymbol })}
                </span>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </form>
    </Form>
  );
});

export default TokenTransfer;
