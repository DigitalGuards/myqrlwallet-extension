import { Button } from "@/components/UI/Button";
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
import StorageUtil from "@/utilities/storageUtil";
import { isQrnsName, resolveQrnsName } from "@/utilities/qrnsResolver";
import { zodResolver } from "@hookform/resolvers/zod";
import { validator, utils, qrl } from "@theqrl/web3";
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

const { Common } = qrl.accounts;

const createFormSchema = (t: TFunction) =>
  z
    .object({
      receiverAddress: z.string().min(1, t('validation.receiverRequired')),
      amount: z.coerce.number().gt(0, t('validation.amountPositive')),
    })
    .refine(
      (fields) =>
        validator.isAddressString(fields.receiverAddress) ||
        isQrnsName(fields.receiverAddress),
      {
        message: t('validation.addressInvalid'),
        path: ["receiverAddress"],
      },
    );

const TokenTransfer = observer(() => {
  const { t } = useTranslation();
  const FormSchema = createFormSchema(t);
  const { state } = useLocation();
  const navigate = useNavigate();
  const { lockStore, qrlStore, ledgerStore, transactionHistoryStore, priceStore, settingsStore } =
    useStore();
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
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
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

  const signNativeTokenLocal = async (formData: z.infer<typeof FormSchema>): Promise<SignResult> => {
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

  const signNativeTokenWithLedger = async (formData: z.infer<typeof FormSchema>): Promise<SignResult> => {
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
        value: `0x${BigInt(utils.toPlanck(formData.amount, "quanta")).toString(16)}`,
        data: "0x",
      };

      const signedRawTxHex = await ledgerStore.signAndSerializeTransaction(accountAddress, txData, common);
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

  const signZrc20TokenLocal = async (formData: z.infer<typeof FormSchema>): Promise<SignResult> => {
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
      // Use resolved QRNS address if available
      if (isQrnsName(formData.receiverAddress) && resolvedAddress) {
        formData = { ...formData, receiverAddress: resolvedAddress };
      }

      // Step 1: Sign the transaction (fast — no blockchain wait)
      let signResult: SignResult;
      if (isZrc20Token) {
        signResult = await signZrc20TokenLocal(formData);
      } else {
        signResult = await signNativeTokenLocal(formData);
      }

      const { transactionHash, rawTransaction, error, nonce, maxFeePerGas, maxPriorityFeePerGas, gasLimit, data } = signResult;

      if (error) {
        control.setError("amount", {
          message: t('transfer.errorOccurred', { error }),
        });
        return;
      }

      if (!transactionHash || !rawTransaction) {
        control.setError("amount", {
          message: t('transfer.errorFailed'),
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
      await transactionHistoryStore.addTransaction(accountAddress, historyEntry);

      // Step 3: Broadcast in background — don't await
      sendRawTransaction(rawTransaction).then(
        async (receipt) => {
          if (receipt) {
            const isSuccess = receipt.status?.toString() === "1";
            await transactionHistoryStore.updateTransaction(
              accountAddress,
              transactionHash,
              {
                pendingStatus: isSuccess ? "confirmed" : "failed",
                status: isSuccess,
                blockNumber: receipt.blockNumber?.toString() ?? "",
                gasUsed: receipt.gasUsed?.toString() ?? "",
                effectiveGasPrice: (receipt.effectiveGasPrice ?? 0).toString(),
              },
            );
            await fetchAccounts();
          }
        },
        async (err) => {
          console.error("[TokenTransfer] Broadcast failed:", err);
          await transactionHistoryStore.updateTransaction(
            accountAddress,
            transactionHash,
            { pendingStatus: "failed", status: false },
          );
        },
      );

      // Step 4: Navigate home immediately — TX is visible as "pending" in history
      await resetForm();
      navigate(ROUTES.TRANSACTION_HISTORY);
    } catch (error) {
      control.setError("amount", {
        message: t('transfer.errorOccurred', { error }),
      });
    }
  }

  const resetForm = async () => {
    await StorageUtil.clearTransactionValues();
    setSliderValue(0);
    reset({ receiverAddress: "", amount: 0 });
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
        amount: storedTransactionValues?.amount ?? 0,
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
    if (!watchedAmount || watchedAmount <= 0 || !estimatedGasFee) {
      setBalanceError("");
      return;
    }

    const gasFee = new BigNumber(estimatedGasFee);
    const sendAmount = new BigNumber(watchedAmount);
    const nativeBalance = parseBalanceValue(getAccountBalance(accountAddress));

    if (isZrc20Token) {
      const tokenBal = parseBalanceValue(tokenBalance);
      if (sendAmount.greaterThan(tokenBal)) {
        setBalanceError(t('transfer.errorInsufficientToken', { tokenSymbol }));
        return;
      }
      if (gasFee.greaterThan(nativeBalance)) {
        setBalanceError(t('transfer.errorInsufficientGas'));
        return;
      }
    } else {
      const totalCost = sendAmount.plus(gasFee);
      if (totalCost.greaterThan(nativeBalance)) {
        setBalanceError(
          t('transfer.errorInsufficientBalance'),
        );
        return;
      }
    }

    setBalanceError("");
  }, [watchedAmount, estimatedGasFee, tokenBalance, isZrc20Token, accountAddress]);

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
      form.setValue("amount", 0, { shouldValidate: true });
      return;
    }
    // For 100% round DOWN at 8 decimals so float parsing can never push
    // the amount above the gas-adjusted balance; below 100% round down to
    // 6 decimals for a readable value.
    const formatted =
      percentage === 100
        ? maxSendable.toFixed(8, BigNumber.ROUND_DOWN)
        : maxSendable
            .times(percentage)
            .dividedBy(100)
            .toFixed(6, BigNumber.ROUND_DOWN);
    const numeric = parseFloat(formatted);
    form.setValue("amount", Number.isFinite(numeric) ? numeric : 0, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  // Typing an amount moves the slider to match.
  useEffect(() => {
    const amountNumber = Number(watchedAmount);
    if (
      !Number.isFinite(amountNumber) ||
      amountNumber <= 0 ||
      maxSendable.isZero()
    ) {
      setSliderValue(0);
      return;
    }
    const percentage = BigNumber.min(
      new BigNumber(amountNumber).dividedBy(maxSendable).times(100),
      100,
    )
      .round(0, BigNumber.ROUND_HALF_UP)
      .toNumber();
    setSliderValue(percentage);
  }, [watchedAmount, maxSendable]);

  const watchedReceiver = watch("receiverAddress");
  const resolveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(resolveTimerRef.current);

    if (!watchedReceiver || !isQrnsName(watchedReceiver)) {
      setResolvedAddress(null);
      setQrnsError(null);
      setQrnsResolving(false);
      return;
    }

    setQrnsResolving(true);
    setQrnsError(null);
    setResolvedAddress(null);

    const rpcUrl = qrlStore.qrlConnection.blockchain.defaultRpcUrl;
    const registry = qrlStore.qrlConnection.blockchain.qrnsRegistryAddress;
    const nameToResolve = watchedReceiver.trim();

    resolveTimerRef.current = setTimeout(() => {
      resolveQrnsName(nameToResolve, rpcUrl, registry)
        .then((addr) => {
          setResolvedAddress(addr);
          setQrnsError(null);
        })
        .catch(() => {
          setResolvedAddress(null);
          setQrnsError(t('transfer.qrnsResolutionFailed'));
        })
        .finally(() => setQrnsResolving(false));
    }, 500);

    return () => clearTimeout(resolveTimerRef.current);
  }, [watchedReceiver]);

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
                <Label className="text-lg">{t('transfer.activeAccount')}</Label>
                <AccountAddressSection tokenBalance={tokenBalance} />
              </div>
              <div className="flex flex-col gap-2">
                <Label className="text-lg">{t('transfer.makeTransaction')}</Label>
                <div className="flex flex-col gap-4">
                  <FormField
                    control={control}
                    name="receiverAddress"
                    render={({ field }) => (
                      <FormItem>
                        <Label>{t('transfer.sendTo')}</Label>
                        <div className="flex items-center gap-1">
                          <FormControl>
                            <Input
                              {...field}
                              aria-label={field.name}
                              autoComplete="off"
                              disabled={isSubmitting}
                              placeholder={t('transfer.receiverPlaceholder')}
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
                          {t('transfer.receiverDescription')}
                        </FormDescription>
                        {qrnsResolving && (
                          <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader className="h-3 w-3 animate-spin" />
                            {t('transfer.qrnsResolving')}
                          </p>
                        )}
                        {resolvedAddress && !qrnsResolving && (
                          <p className="text-xs text-success">
                            → {resolvedAddress}
                          </p>
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
                        <Label>{t('transfer.amountLabel')}</Label>
                        <div className="relative">
                          <FormControl>
                            <Input
                              {...field}
                              aria-label={field.name}
                              autoComplete="off"
                              className="pr-16"
                              disabled={isSubmitting}
                              placeholder={t('transfer.amountPlaceholder')}
                              type="number"
                              step="any"
                              onWheel={(e) => (e.target as HTMLInputElement).blur()}
                            />
                          </FormControl>
                          <span className="pointer-events-none absolute right-3 top-1/2 max-w-14 -translate-y-1/2 truncate text-sm text-muted-foreground">
                            {tokenSymbol}
                          </span>
                        </div>

                        <div className="mt-2 flex flex-col gap-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              {t('transfer.percentOfBalance')}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {sliderValue}%
                            </span>
                          </div>
                          <Slider
                            aria-label={t('transfer.percentOfBalance')}
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
                                  ? t('transfer.max')
                                  : `${percentage}%`}
                              </Button>
                            ))}
                          </div>
                        </div>

                        <FormDescription>
                          {t('transfer.amountDescription')}
                          {!isZrc20Token &&
                            settingsStore.showBalanceAndPrice &&
                            priceStore.getPrice(settingsStore.currency) > 0 &&
                            field.value > 0 && (
                              <span className="ml-1 text-muted-foreground">
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
                    to={watch().receiverAddress}
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
                className="w-full"
                type="button"
                variant="outline"
                onClick={() => cancelTransaction()}
              >
                <X className="mr-2 h-4 w-4" />
                {t('transfer.cancelButton')}
              </Button>
              <Button disabled={isSubmitting || !isValid || !!balanceError || qrnsResolving || (isQrnsName(watchedReceiver) && !resolvedAddress)} className="w-full">
                {isSubmitting ? (
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                {isSubmitting
                  ? t('transfer.sendingButton', { tokenSymbol })
                  : t('transfer.sendButton', { tokenSymbol })}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </form>
    </Form>
  );
});

export default TokenTransfer;
