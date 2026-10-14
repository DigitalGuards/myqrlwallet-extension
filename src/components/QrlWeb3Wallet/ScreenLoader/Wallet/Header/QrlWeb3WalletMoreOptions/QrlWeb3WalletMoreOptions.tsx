import { Button } from "@/components/UI/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/UI/DropdownMenu";
import { APP_TAB_FILE } from "@/constants/qrlWeb3Wallet";
import { SIDE_PANEL_PATH } from "@/scripts/utils/sidePanelPreference";
import { ROUTES } from "@/router/router";
import { useStore } from "@/stores/store";
import {
  BookUser,
  EllipsisVertical,
  Expand,
  LockKeyhole,
  PanelLeft,
  PanelRight,
  Settings,
} from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import browser from "webextension-polyfill";

const extensionGlobals: {
  chrome?: { sidePanel?: Partial<(typeof globalThis)["chrome"]["sidePanel"]> };
} = globalThis;

const QrlWeb3WalletMoreOptions = observer(() => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { lockStore, settingsStore } = useStore();
  const { isPopupWindow, isSidePanel } = settingsStore;

  const openInTab = () => {
    browser.tabs
      .create({
        url: browser.runtime.getURL(APP_TAB_FILE),
      })
      .catch((error: unknown) => {
        console.error("Failed to open wallet tab:", error);
      });
  };

  const sidePanel = extensionGlobals.chrome?.sidePanel;
  const hasSidePanelApi = typeof sidePanel?.open === "function";

  const openAsSidePanel = async () => {
    try {
      await settingsStore.setSidePanelPreferred(true);
      if (!sidePanel?.setOptions || !sidePanel.open) return;
      await sidePanel.setOptions({ path: SIDE_PANEL_PATH });
      const win = await browser.windows.getCurrent();
      if (win.id !== undefined) {
        await sidePanel.open({ windowId: win.id });
      }
      window.close();
    } catch {
      // Fail gracefully if any step fails.
    }
  };

  const switchToPopup = async () => {
    try {
      await settingsStore.setSidePanelPreferred(false);
      window.close();
    } catch {
      // Fail gracefully.
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 hover:bg-accent hover:text-secondary"
          aria-label={t("common.more")}
          data-testid="ellipsis-icon"
        >
          <EllipsisVertical size="16" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          {(isPopupWindow || isSidePanel) && (
            <DropdownMenuItem
              className="cursor-pointer data-[highlighted]:text-secondary"
              onClick={openInTab}
            >
              <div className="flex gap-2">
                <Expand size="16" />
                <span>{t("header.openInTab")}</span>
              </div>
            </DropdownMenuItem>
          )}
          {isPopupWindow && hasSidePanelApi && (
            <DropdownMenuItem
              className="cursor-pointer data-[highlighted]:text-secondary"
              onClick={() => {
                void openAsSidePanel();
              }}
            >
              <div className="flex gap-2">
                <PanelRight size="16" />
                <span>{t("header.openSidePanel")}</span>
              </div>
            </DropdownMenuItem>
          )}
          {isSidePanel && hasSidePanelApi && (
            <DropdownMenuItem
              className="cursor-pointer data-[highlighted]:text-secondary"
              onClick={() => {
                void switchToPopup();
              }}
            >
              <div className="flex gap-2">
                <PanelLeft size="16" />
                <span>{t("header.switchToPopup")}</span>
              </div>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="cursor-pointer data-[highlighted]:text-secondary"
            onClick={() => {
              Promise.resolve(navigate(ROUTES.CONTACTS)).catch(
                (error: unknown) => {
                  console.error("Failed to navigate wallet:", error);
                },
              );
            }}
          >
            <div className="flex gap-2">
              <BookUser size="16" />
              <span>{t("header.contacts")}</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer data-[highlighted]:text-secondary"
            onClick={() => {
              Promise.resolve(navigate(ROUTES.SETTINGS)).catch(
                (error: unknown) => {
                  console.error("Failed to navigate wallet:", error);
                },
              );
            }}
          >
            <div className="flex gap-2">
              <Settings size="16" />
              <span>{t("header.settings")}</span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer data-[highlighted]:text-secondary"
            onClick={() => {
              lockStore.lock().catch((error: unknown) => {
                console.error("Failed to lock wallet:", error);
              });
            }}
          >
            <div className="flex gap-2">
              <LockKeyhole size="16" />
              <span>{t("header.lockWallet")}</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export default QrlWeb3WalletMoreOptions;
