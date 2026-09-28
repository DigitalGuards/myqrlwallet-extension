import BrandMark from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/BrandMark/BrandMark";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { Separator } from "@/components/UI/Separator";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import { ExternalLink, Mail, MoveLeft } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";

const WALLET_VERSION =
  typeof chrome !== "undefined" && chrome.runtime?.getManifest
    ? chrome.runtime.getManifest().version
    : "0.4.0";
const REPO_URL = "https://github.com/DigitalGuards/myqrlwallet-extension";

interface AboutLink {
  /** i18n key under settings.about.* for the row label. */
  labelKey: string;
  href: string;
}

// Plain anchors with target=_blank: an extension page may open any https or
// mailto URL in a new tab without host permissions, and the extension_pages
// CSP only governs scripts and objects.
const LEGAL_LINKS: AboutLink[] = [
  { labelKey: "settings.about.privacy", href: "https://qrlwallet.com/privacy" },
  { labelKey: "settings.about.terms", href: "https://qrlwallet.com/terms" },
  {
    labelKey: "settings.about.disclaimer",
    href: "https://qrlwallet.com/disclaimer",
  },
  {
    labelKey: "settings.about.legalNotice",
    href: "https://qrlwallet.com/legal",
  },
  {
    labelKey: "settings.about.licenses",
    href: `${REPO_URL}/blob/main/LICENSE`,
  },
];

const HELP_LINKS: AboutLink[] = [
  { labelKey: "settings.about.website", href: "https://myqrlwallet.com" },
  { labelKey: "settings.about.webWallet", href: "https://qrlwallet.com" },
  { labelKey: "settings.about.github", href: REPO_URL },
  {
    labelKey: "settings.about.security",
    href: "https://qrlwallet.com/security",
  },
  { labelKey: "settings.about.contact", href: "mailto:info@digitalguards.nl" },
  { labelKey: "settings.about.x", href: "https://x.com/myqrlwallet" },
];

const SettingsAbout = observer(() => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { qrlConnection, qrlAccounts } = qrlStore;
  const networkName = qrlConnection.blockchain.chainName;
  const chainId = parseInt(qrlConnection.blockchain.chainId, 16);
  const accountCount = qrlAccounts.accounts.length;

  const renderLinkGroup = (headingKey: string, links: AboutLink[]) => (
    <section aria-labelledby={headingKey}>
      <h4
        id={headingKey}
        className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {t(headingKey)}
      </h4>
      <ul className="-mx-2 divide-y divide-border">
        {links.map(({ labelKey, href }) => {
          const isMail = href.startsWith("mailto:");
          const Icon = isMail ? Mail : ExternalLink;
          return (
            <li key={labelKey}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center justify-between gap-3 rounded-md px-2 py-2.5 text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>{t(labelKey)}</span>
                <Icon
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="sr-only">
                  {t(
                    isMail
                      ? "settings.about.opensMail"
                      : "settings.about.opensInNewTab",
                  )}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );

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
              {t("settings.about.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4 text-sm">
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <BrandMark
                  className="h-14 w-14 text-primary"
                  title="MyQRLWallet"
                />
                <p className="font-medium text-foreground">
                  {t("settings.about.versionLine", {
                    version: WALLET_VERSION,
                  })}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("settings.about.network")}
                  </span>
                  <span>{networkName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("settings.about.chainId")}
                  </span>
                  <span>{chainId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t("settings.about.accounts")}
                  </span>
                  <span>{accountCount}</span>
                </div>
              </div>
              <Separator />
              {renderLinkGroup("settings.about.legalGroup", LEGAL_LINKS)}
              <Separator />
              {renderLinkGroup("settings.about.helpGroup", HELP_LINKS)}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
});

export default SettingsAbout;
