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
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import { MoveLeft } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";

const SettingsAppearance = observer(() => {
  const navigate = useNavigate();
  const { settingsStore } = useStore();
  const { t } = useTranslation();
  const { themePreference, setThemePreference } = settingsStore;

  const THEME_OPTIONS = [
    { value: "system", label: t("settings.appearance.system") },
    { value: "light", label: t("settings.appearance.light") },
    { value: "dark", label: t("settings.appearance.dark") },
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
              {t("settings.appearance.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Label className="mb-2 block text-xs text-muted-foreground">
              {t("settings.appearance.themeLabel")}
            </Label>
            <Select
              value={themePreference}
              onValueChange={(value) =>
                setThemePreference(value as "system" | "light" | "dark")
              }
            >
              <SelectTrigger aria-label="Theme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>
    </div>
  );
});

export default SettingsAppearance;
