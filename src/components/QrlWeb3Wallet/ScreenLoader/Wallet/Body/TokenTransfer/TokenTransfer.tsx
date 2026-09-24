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
import { formatFiatCompact } from "@/functions/formatFiat";
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

const createFormSchema = (t: TFunction) =>
  z
    .object({
      receiverAddress: z.string().min(1, t("validation.receiverRequired")),
      amount: z
        .string()
        .regex(/^(?:\d+\.?\d*|\.\d+)$/, t("validation.amountPositive"))
        .refine(
          (value) =>
            /^(?:\d+\.?\d*|\.\d+)$/.test(value) && new BigNumber(value).gt(0),
          t("validation.amountPositive"),
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

const TokenTransfer = observer(() => {
  const { t } = useTranslation();
  const FormSchema = createFormSchema(t);
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
  } = qrlStore;
  const { accountAddress } = activeAccount;

  const [isZrc20Token, setIsZrc20Token] = useState(false);
  const [tokenContractAddress, setTokenContractAddress] = useState("");
  const [tokenDecimals, setTokenDecimals] = useState(0);
  const [tokenImage, setTokenImage] = useState(NATIVE_TOKEN.image);
  const [tokenBalance, setTokenBalance] = useState("");
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
      const nonce = await qrlInstance?.getTransactionCount(accountAddress);
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
      toTokenBaseUnits(formData.amount, isZrc20Token ? tokenDecimals : 18);
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
        let tokenDetails = {
          isZrc20Token,
          tokenContractAddress,
          tokenDecimals,
          tokenImage,
          tokenBalance,
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
    tokenName,
    tokenSymbol,
  ]);

  const watchedAmount = watch("amount");
  useEffect(() => {
    if (
      !watchedAmount ||
      !amountForDisplay(watchedAmount).gt(0) ||
      !estimatedGasFee
    ) {
      setBalanceError("");
      return;
    }

    const gasFee = new BigNumber(estimatedGasFee);
    const sendAmount = amountForDisplay(watchedAmount);
    const nativeBalance = parseBalanceValue(getAccountBalance(accountAddress));

    if (isZrc20Token) {
      const tokenBal = parseBalanceValue(tokenBalance);
      if (sendAmount.greaterThan(tokenBal)) {
        setBalanceError(t("transfer.errorInsufficientToken", { tokenSymbol }));
        return;
      }
      if (gasFee.greaterThan(nativeBalance)) {
        setBalanceError(t("transfer.errorInsufficientGas"));
        return;
      }
    } else {
      const totalCost = sendAmount.plus(gasFee);
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
    if (isZrc20Token) return parseBalanceValue(tokenBalance);
    const balance = parseBalanceValue(getAccountBalance(accountAddress));
    const reserve = new BigNumber(nativeGasReserve || "0");
    const sendable = balance.minus(reserve);
    return sendable.gt(0) ? sendable : new BigNumber(0);
  }, [
    isZrc20Token,
    tokenBalance,
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
                            priceStore.getPrice(settingsStore.currency) > 0 &&
                            amountForDisplay(field.value || "0").gt(0) && (
                              <span className="ml-1 font-numeric text-muted-foreground">
                                {formatFiatCompact(
                                  field.value,
                                  priceStore.getPrice(settingsStore.currency),
                                  settingsStore.currency,
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
