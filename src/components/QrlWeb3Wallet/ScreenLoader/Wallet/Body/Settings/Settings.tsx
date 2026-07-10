import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { ROUTES } from "@/router/router";
import {
  ChevronRight,
  Download,
  Globe,
  Info,
  Palette,
  Shield,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";

const Settings = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const MENU_ITEMS = [
    { label: t("settings.appearance"), icon: Palette, route: ROUTES.SETTINGS_APPEARANCE },
    { label: t("settings.security"), icon: Shield, route: ROUTES.SETTINGS_SECURITY },
    { label: t("settings.preferences"), icon: Globe, route: ROUTES.SETTINGS_PREFERENCES },
    { label: t("settings.data"), icon: Download, route: ROUTES.SETTINGS_DATA },
    { label: t("settings.about"), icon: Info, route: ROUTES.SETTINGS_ABOUT },
  ];

  return (
    <div className="w-full">
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{t("settings.title")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {MENU_ITEMS.map((item, index) => (
              <div
                key={item.label}
                className={`flex cursor-pointer items-center justify-between px-6 py-3 transition-colors hover:bg-accent ${
                  index < MENU_ITEMS.length - 1 ? "border-b" : ""
                }`}
                onClick={() => navigate(item.route)}
              >
                <div className="flex items-center gap-3">
                  <item.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{item.label}</span>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Settings;
