import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { Label } from "@/components/UI/Label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/UI/Select";
import { Separator } from "@/components/UI/Separator";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import type { GasTier } from "@/types/gasFee";
import { MoveLeft } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";

const CURRENCY_OPTIONS = ["USD", "EUR", "PLN", "GBP", "CHF", "JPY"];
const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "de", label: "Deutsch" },
];

const SettingsPreferences = observer(() => {
  const navigate = useNavigate();
  const { settingsStore } = useStore();
  const { t } = useTranslation();
  const {
    currency,
    setCurrency,
    language,
    setLanguage,
    defaultGasTier,
    setDefaultGasTier,
  } = settingsStore;

  const GAS_TIER_OPTIONS: { value: GasTier; label: string }[] = [
    { value: "low", label: t("settings.preferences.gasLow") },
    { value: "market", label: t("settings.preferences.gasMarket") },
    { value: "aggressive", label: t("settings.preferences.gasAggressive") },
  ];

  return (
    <div className="w-full">
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MoveLeft
                className="cursor-pointer transition-all hover:text-secondary"
                onClick={() => navigate(ROUTES.SETTINGS)}
                data-testid="back-arrow"
              />
              {t("settings.preferences.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <Label className="mb-2 block text-xs text-muted-foreground">
                {t("settings.preferences.currencyLabel")}
              </Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger aria-label="Display currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div>
              <Label className="mb-2 block text-xs text-muted-foreground">
                {t("settings.preferences.languageLabel")}
              </Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger aria-label="Language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <div>
              <Label className="mb-2 block text-xs text-muted-foreground">
                {t("settings.preferences.gasLabel")}
              </Label>
              <Select
                value={defaultGasTier}
                onValueChange={(v) => setDefaultGasTier(v as GasTier)}
              >
                <SelectTrigger aria-label="Default gas fee">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GAS_TIER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
});

export default SettingsPreferences;
