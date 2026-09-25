import { Alert, AlertDescription } from "@/components/UI/Alert";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";

/**
 * One-time notice for installs that predate the side-panel default. It is
 * armed by runtime.onInstalled (update only, and only when the user never
 * made an explicit surface choice), so a fresh install never sees it.
 *
 * Dismissing it, or taking the inline switch back to the popup, clears the
 * flag for good.
 *
 * Both actions sit in the left-aligned text flow. The wallet shell can run
 * wider than a narrow side panel and clip its right edge, which would hide
 * a corner-anchored close control.
 */
const SidePanelNotice = observer(() => {
  const { t } = useTranslation();
  const { settingsStore } = useStore();
  const {
    sidePanelNoticePending,
    dismissSidePanelNotice,
    setSidePanelPreferred,
  } = settingsStore;

  if (!sidePanelNoticePending) {
    return null;
  }

  return (
    <div className="px-4 pt-4">
      <Alert className="border-border bg-muted/40">
        <AlertDescription className="text-muted-foreground">
          <p>{t("sidePanelNotice.message")}</p>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            <button
              type="button"
              className="font-medium text-primary underline underline-offset-2"
              onClick={() => setSidePanelPreferred(false)}
            >
              {t("sidePanelNotice.usePopup")}
            </button>
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={dismissSidePanelNotice}
            >
              {t("sidePanelNotice.dismiss")}
            </button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
});

export default SidePanelNotice;
