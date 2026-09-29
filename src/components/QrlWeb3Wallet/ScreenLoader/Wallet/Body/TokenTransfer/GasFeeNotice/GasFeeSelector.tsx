import { Input } from "@/components/UI/Input";
import { Label } from "@/components/UI/Label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/UI/Tooltip";
import { NATIVE_TOKEN_UNITS_OF_GAS } from "@/constants/nativeToken";
import { formatFiatCompact } from "@/functions/formatFiat";
import { getOptimalGasFee } from "@/functions/getOptimalGasFee";
import { useStore } from "@/stores/store";
import type { GasFeeOverrides, GasTier } from "@/types/gasFee";
import { cn } from "@/utilities/stylingUtil";
import { ChevronDown, ChevronUp, Info, Loader } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type GasFeeSelectorProps = {
  isZrc20Token: boolean;
  tokenContractAddress: string;
  tokenDecimals: number;
  from: string;
  to: string;
  value: string | number;
  disabled?: boolean;
  onOverridesChange: (overrides: GasFeeOverrides) => void;
  onGasFeeCalculated?: (gasFee: string) => void;
  onEstimateError?: (message: string) => void;
};

type TierConfig = {
  value: GasTier;
  label: string;
  description: string;
};

export const GasFeeSelector = observer(
  ({
    isZrc20Token,
    tokenContractAddress,
    tokenDecimals,
    from,
    to,
    value,
    disabled,
    onOverridesChange,
    onGasFeeCalculated,
    onEstimateError,
  }: GasFeeSelectorProps) => {
    const { t } = useTranslation();
    const { settingsStore, qrlStore, priceStore } = useStore();

    const TIERS: TierConfig[] = useMemo(
      () => [
        {
          value: "low" as GasTier,
          label: t("gasFee.tierLow"),
          description: t("gasFee.tierLowDescription"),
        },
        {
          value: "market" as GasTier,
          label: t("gasFee.tierMarket"),
          description: t("gasFee.tierMarketDescription"),
        },
        {
          value: "aggressive" as GasTier,
          label: t("gasFee.tierAggressive"),
          description: t("gasFee.tierAggressiveDescription"),
        },
      ],
      [t],
    );
    const { defaultGasTier, showBalanceAndPrice, currency } = settingsStore;
    const { price: qrlPrice, currency: quoteCurrency } =
      priceStore.quoteFor(currency);
    const { getNativeTokenGas, getZrc20TokenGas } = qrlStore;

    // The stored "advanced" preference has no preset values behind it, so it
    // starts the form on Market with the advanced panel closed.
    const preferredTier =
      defaultGasTier === "advanced" ? "market" : defaultGasTier;

    const [selectedTier, setSelectedTier] = useState<GasTier>(preferredTier);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [advancedValues, setAdvancedValues] = useState({
      maxPriorityFeePerGas: "",
      maxFeePerGas: "",
      gasLimit: "",
    });

    const [tierCosts, setTierCosts] = useState<Record<string, string>>({});
    const [advancedCost, setAdvancedCost] = useState("");
    const [isLoadingCosts, setIsLoadingCosts] = useState(true);
    const [estimateFailed, setEstimateFailed] = useState(false);

    // Read inside the cost effect without making it a dependency: the effect
    // re-runs on the inputs it prices, and only needs the CURRENT selection
    // when it reports a cost back. Closing over the state directly reported
    // the cost of whichever tier was selected when the effect last started.
    const selectedTierRef = useRef(selectedTier);
    selectedTierRef.current = selectedTier;
    const showAdvancedRef = useRef(showAdvanced);
    showAdvancedRef.current = showAdvanced;
    // Set once the user picks a tier themselves, after which a late-loading
    // stored preference must not move their choice.
    const tierChosenByUserRef = useRef(false);

    const hasValuesForGasCalculation = !!from && !!to && !!value;

    const reportEstimateFailure = useCallback(
      (failed: boolean) => {
        setEstimateFailed(failed);
        onEstimateError?.(failed ? t("gasFee.estimateFailed") : "");
      },
      [onEstimateError, t],
    );

    const calculateGas = useCallback(
      async (overrides: GasFeeOverrides): Promise<string> => {
        if (isZrc20Token) {
          return await getZrc20TokenGas(
            from,
            to,
            value,
            tokenContractAddress,
            tokenDecimals,
            overrides,
          );
        }
        return await getNativeTokenGas(overrides);
      },
      [
        from,
        to,
        value,
        isZrc20Token,
        tokenContractAddress,
        tokenDecimals,
        getNativeTokenGas,
        getZrc20TokenGas,
      ],
    );

    const buildOverrides = useCallback(
      (tier: GasTier, advanced = advancedValues): GasFeeOverrides => {
        if (tier === "advanced") {
          return {
            tier: "advanced",
            maxPriorityFeePerGas: advanced.maxPriorityFeePerGas
              ? BigInt(advanced.maxPriorityFeePerGas)
              : undefined,
            maxFeePerGas: advanced.maxFeePerGas
              ? BigInt(advanced.maxFeePerGas)
              : undefined,
            gasLimit: advanced.gasLimit ? Number(advanced.gasLimit) : undefined,
          };
        }
        return { tier };
      },
      [advancedValues],
    );

    // The stored default tier is loaded asynchronously, so it can arrive
    // after the first render. Until the user picks a tier themselves, keep
    // the selection and the reported overrides on that preference: without
    // this the setting was displayed in Settings but the form always signed
    // at the store's market fallback.
    useEffect(() => {
      if (tierChosenByUserRef.current || showAdvancedRef.current) return;
      setSelectedTier(preferredTier);
      onOverridesChange({ tier: preferredTier });
      onGasFeeCalculated?.(tierCosts[preferredTier] ?? "");
    }, [preferredTier]);

    useEffect(() => {
      if (!hasValuesForGasCalculation) {
        // Nothing to price means nothing to fail on. A verdict left over
        // from the previous recipient or amount kept Send disabled with no
        // visible reason, because this component renders nothing at all in
        // this state and cannot show the message it is blocking on.
        reportEstimateFailure(false);
        return;
      }

      let cancelled = false;
      setIsLoadingCosts(true);

      (async () => {
        // allSettled keeps every tier that priced successfully. Under
        // Promise.all one tier failing (a reverting estimate, a dropped
        // RPC call) discarded the other two and left the send form with no
        // fee at all, which silently turned the balance guard off.
        const results = await Promise.allSettled(
          TIERS.map((tier) => calculateGas({ tier: tier.value })),
        );
        if (cancelled) return;

        const costs: Record<string, string> = {};
        // Only a thrown estimate is a failure worth blocking the send on: an
        // empty string just means the store had nothing to price against
        // (no contract handle yet), which is a transient startup state.
        let anyFailed = false;
        results.forEach((result, index) => {
          const tierValue = TIERS[index].value;
          if (result.status === "fulfilled") {
            if (result.value) costs[tierValue] = result.value;
          } else {
            anyFailed = true;
            console.error(
              "[GasFeeSelector] Gas estimate failed:",
              result.reason,
            );
          }
        });
        setTierCosts(costs);
        setIsLoadingCosts(false);

        // Advanced mode has its own estimate and its own verdict; the
        // effect below owns both while it is open.
        if (!showAdvancedRef.current) {
          reportEstimateFailure(anyFailed);
          onGasFeeCalculated?.(costs[selectedTierRef.current] ?? "");
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [
      from,
      to,
      value,
      hasValuesForGasCalculation,
      calculateGas,
      reportEstimateFailure,
    ]);

    // Advanced mode prices its own worst case (gas limit x max fee) on every
    // change, so the send form keeps a real fee to guard the balance with
    // and the user can see what their override costs.
    useEffect(() => {
      if (!showAdvanced || !hasValuesForGasCalculation) return;

      let cancelled = false;
      (async () => {
        try {
          const cost = await calculateGas(
            buildOverrides("advanced", advancedValues),
          );
          if (cancelled) return;
          setAdvancedCost(cost);
          onGasFeeCalculated?.(cost);
          reportEstimateFailure(false);
        } catch (error) {
          if (cancelled) return;
          console.error(
            "[GasFeeSelector] Advanced gas estimate failed:",
            error,
          );
          setAdvancedCost("");
          onGasFeeCalculated?.("");
          reportEstimateFailure(true);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [
      showAdvanced,
      advancedValues,
      hasValuesForGasCalculation,
      calculateGas,
    ]);

    const selectTier = (tier: GasTier) => {
      tierChosenByUserRef.current = true;
      setSelectedTier(tier);
      setShowAdvanced(false);
      showAdvancedRef.current = false;
      const overrides = buildOverrides(tier);
      onOverridesChange(overrides);
      onGasFeeCalculated?.(tierCosts[tier] ?? "");
    };

    const toggleAdvanced = async () => {
      if (showAdvanced) {
        // Collapse - revert to selected tier
        const overrides = buildOverrides(selectedTier);
        onOverridesChange(overrides);
        onGasFeeCalculated?.(tierCosts[selectedTier] ?? "");
        setShowAdvanced(false);
        showAdvancedRef.current = false;
      } else {
        tierChosenByUserRef.current = true;
        // Expand - pre-fill with current Market values
        try {
          const { maxPriorityFeePerGas, maxFeePerGas } =
            await qrlStore.getGasFeeData({ tier: "market" });
          const prefilled = {
            maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
            maxFeePerGas: maxFeePerGas.toString(),
            gasLimit: String(NATIVE_TOKEN_UNITS_OF_GAS),
          };
          setAdvancedValues(prefilled);
          onOverridesChange(buildOverrides("advanced", prefilled));
        } catch {
          onOverridesChange(buildOverrides("advanced"));
        }
        // The advanced cost effect reports the fee for these values; the
        // previous tier's fee stays reported until it does, so the balance
        // guard is never briefly disarmed.
        setShowAdvanced(true);
        showAdvancedRef.current = true;
      }
    };

    const handleAdvancedChange = (
      field: keyof typeof advancedValues,
      rawValue: string,
    ) => {
      const sanitized = rawValue.replace(/[^0-9]/g, "");
      const updated = { ...advancedValues, [field]: sanitized };
      setAdvancedValues(updated);
      onOverridesChange(buildOverrides("advanced", updated));
    };

    if (!hasValuesForGasCalculation) return null;

    return (
      <TooltipProvider delayDuration={200}>
        <div className="m-1">
          <Label className="mb-2 block text-xs text-muted-foreground">
            {t("gasFee.label")}
          </Label>
          <div className="flex flex-col gap-1">
            {TIERS.map((tier) => {
              const isSelected = !showAdvanced && selectedTier === tier.value;
              const cost = tierCosts[tier.value];

              return (
                <button
                  key={tier.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => selectTier(tier.value)}
                  className={cn(
                    "flex items-center justify-between rounded-md border px-3 py-2 text-left transition-all",
                    "hover:border-secondary/50",
                    isSelected
                      ? "border-secondary bg-secondary/10"
                      : "border-border",
                    disabled && "pointer-events-none opacity-50",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full",
                        isSelected ? "bg-secondary" : "bg-muted-foreground/30",
                      )}
                    />
                    <div>
                      <div className="text-sm font-medium">{tier.label}</div>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-52 text-xs">
                        {tier.description}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex flex-col items-end text-right font-numeric text-xs text-muted-foreground">
                    {isLoadingCosts ? (
                      <Loader className="h-3 w-3 animate-spin" />
                    ) : cost ? (
                      <>
                        <span>{getOptimalGasFee(cost)}</span>
                        {showBalanceAndPrice && qrlPrice > 0 && (
                          <span className="text-[10px]">
                            {formatFiatCompact(cost, qrlPrice, quoteCurrency)}
                          </span>
                        )}
                      </>
                    ) : (
                      "-"
                    )}
                  </div>
                </button>
              );
            })}

            {/* Advanced toggle */}
            <button
              type="button"
              disabled={disabled}
              onClick={toggleAdvanced}
              className={cn(
                "flex items-center justify-between rounded-md border px-3 py-2 text-left transition-all",
                "hover:border-secondary/50",
                showAdvanced
                  ? "border-secondary bg-secondary/10"
                  : "border-border",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "h-2 w-2 rounded-full",
                    showAdvanced ? "bg-secondary" : "bg-muted-foreground/30",
                  )}
                />
                <div className="text-sm font-medium">
                  {t("gasFee.tierAdvanced")}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-52 text-xs">
                    {t("gasFee.tierAdvancedDescription")}
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                {showAdvanced && advancedCost && (
                  <div className="flex flex-col items-end text-right font-numeric text-xs text-muted-foreground">
                    <span>{getOptimalGasFee(advancedCost)}</span>
                    {showBalanceAndPrice && qrlPrice > 0 && (
                      <span className="text-[10px]">
                        {formatFiatCompact(
                          advancedCost,
                          qrlPrice,
                          quoteCurrency,
                        )}
                      </span>
                    )}
                  </div>
                )}
                {showAdvanced ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </button>

            {showAdvanced && (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">
                    {t("gasFee.maxPriorityFee")}
                  </Label>
                  <Input
                    id="gasMaxPriorityFeePerGas"
                    name="gasMaxPriorityFeePerGas"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={t("gasFee.placeholderAuto")}
                    value={advancedValues.maxPriorityFeePerGas}
                    onChange={(e) =>
                      handleAdvancedChange(
                        "maxPriorityFeePerGas",
                        e.target.value,
                      )
                    }
                    disabled={disabled}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">
                    {t("gasFee.maxFee")}
                  </Label>
                  <Input
                    id="gasMaxFeePerGas"
                    name="gasMaxFeePerGas"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={t("gasFee.placeholderAuto")}
                    value={advancedValues.maxFeePerGas}
                    onChange={(e) =>
                      handleAdvancedChange("maxFeePerGas", e.target.value)
                    }
                    disabled={disabled}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="mb-1 block text-xs text-muted-foreground">
                    {t("gasFee.gasLimit")}
                  </Label>
                  <Input
                    id="gasLimit"
                    name="gasLimit"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={t("gasFee.placeholderAuto")}
                    value={advancedValues.gasLimit}
                    onChange={(e) =>
                      handleAdvancedChange("gasLimit", e.target.value)
                    }
                    disabled={disabled}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            )}
            {estimateFailed && (
              <p className="text-xs text-destructive">
                {t("gasFee.estimateFailed")}
              </p>
            )}
          </div>
        </div>
      </TooltipProvider>
    );
  },
);
