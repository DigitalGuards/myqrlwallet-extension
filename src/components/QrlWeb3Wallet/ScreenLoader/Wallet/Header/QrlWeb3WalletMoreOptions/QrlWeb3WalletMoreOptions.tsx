import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/UI/DropdownMenu";
import { APP_TAB_FILE } from "@/constants/qrlWeb3Wallet";
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

const QrlWeb3WalletMoreOptions = observer(() => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { lockStore, settingsStore } = useStore();
  const { isPopupWindow, isSidePanel, setSidePanelPreferred } = settingsStore;
  const { lock } = lockStore;

  const openInTab = () => {
    browser.tabs.create({
      url: browser.runtime.getURL(APP_TAB_FILE),
    });
  };

  const hasSidePanelApi =
    typeof chrome !== "undefined" &&
    typeof chrome?.sidePanel?.open === "function";

  const openAsSidePanel = async () => {
    try {
      await setSidePanelPreferred(true);
      await chrome.sidePanel.setOptions({ path: "index.html?sidepanel=true" });
      const win = await browser.windows.getCurrent();
      if (win.id !== undefined) {
        await chrome.sidePanel.open({ windowId: win.id });
      }
      window.close();
    } catch {
      // Fail gracefully if any step fails.
    }
  };

  const switchToPopup = async () => {
    try {
      await setSidePanelPreferred(false);
      window.close();
    } catch {
      // Fail gracefully.
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <EllipsisVertical
          size="16"
          className="cursor-pointer"
          data-testid="ellipsis-icon"
        />
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
                <button aria-label="Open in tab">{t('header.openInTab')}</button>
              </div>
            </DropdownMenuItem>
          )}
          {isPopupWindow && hasSidePanelApi && (
            <DropdownMenuItem
              className="cursor-pointer data-[highlighted]:text-secondary"
              onClick={openAsSidePanel}
            >
              <div className="flex gap-2">
                <PanelRight size="16" />
                <button aria-label="Open as Side Panel">{t('header.openSidePanel')}</button>
              </div>
            </DropdownMenuItem>
          )}
          {isSidePanel && hasSidePanelApi && (
            <DropdownMenuItem
              className="cursor-pointer data-[highlighted]:text-secondary"
              onClick={switchToPopup}
            >
              <div className="flex gap-2">
                <PanelLeft size="16" />
                <button aria-label="Switch to Popup">{t('header.switchToPopup')}</button>
              </div>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="cursor-pointer data-[highlighted]:text-secondary"
            onClick={() => navigate(ROUTES.CONTACTS)}
          >
            <div className="flex gap-2">
              <BookUser size="16" />
              <button aria-label="Contacts">{t('header.contacts')}</button>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer data-[highlighted]:text-secondary"
            onClick={() => navigate(ROUTES.SETTINGS)}
          >
            <div className="flex gap-2">
              <Settings size="16" />
              <button aria-label="Settings">{t('header.settings')}</button>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer data-[highlighted]:text-secondary"
            onClick={lock}
          >
            <div className="flex gap-2">
              <LockKeyhole size="16" />
              <button aria-label="Lock Wallet">{t('header.lockWallet')}</button>
            </div>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export default QrlWeb3WalletMoreOptions;
