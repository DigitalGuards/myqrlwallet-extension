import i18n from "@/i18n";
import { LOCK_MANAGER_MESSAGES } from "@/scripts/lockManager/lockManager";
import {
  resolveSidePanelPreferred,
  SIDE_PANEL_PATH,
} from "@/scripts/utils/sidePanelPreference";
import type { GasTier } from "@/types/gasFee";
import StorageUtil from "@/utilities/storageUtil";
import { action, makeAutoObservable, observable, runInAction } from "mobx";
import browser from "webextension-polyfill";

const THEME = Object.freeze({
  DARK: "dark",
  LIGHT: "light",
});

type ThemePreference = "system" | "light" | "dark";
type SidePanelSurface = "panel" | "popup";


class SettingsStore {
  isDarkMode: boolean;
  theme: string;
  isPopupWindow = true;
  isSidePanel = false;

  themePreference: ThemePreference = "system";
  autoLockMinutes = 15;
  currency = "USD";
  language = "en";
  defaultGasTier: GasTier = "market";
  showBalanceAndPrice = true;
  // Resolved surface default. True wherever the side panel API exists and
  // the user has not explicitly chosen the popup.
  sidePanelPreferred = false;
  // The explicit choice, undefined until the user makes one.
  sidePanelSurface: SidePanelSurface | undefined = undefined;
  // One-time "the wallet moved to the side panel" notice, armed by
  // runtime.onInstalled for installs that predate this version.
  sidePanelNoticePending = false;
  sidePanelNoticeSeen = false;
  notificationsEnabled = true;
  phishingDetectionEnabled = true;

  constructor() {
    makeAutoObservable(this, {
      isDarkMode: observable,
      theme: observable,
      isSidePanel: observable,
      themePreference: observable,
      autoLockMinutes: observable,
      currency: observable,
      language: observable,
      defaultGasTier: observable,
      showBalanceAndPrice: observable,
      sidePanelPreferred: observable,
      sidePanelSurface: observable,
      sidePanelNoticePending: observable,
      sidePanelNoticeSeen: observable,
      notificationsEnabled: observable,
      phishingDetectionEnabled: observable,
      setThemePreference: action.bound,
      setAutoLockMinutes: action.bound,
      setCurrency: action.bound,
      setLanguage: action.bound,
      setDefaultGasTier: action.bound,
      setShowBalanceAndPrice: action.bound,
      setSidePanelPreferred: action.bound,
      dismissSidePanelNotice: action.bound,
      setNotificationsEnabled: action.bound,
      setPhishingDetectionEnabled: action.bound,
    });

    this.isDarkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;
    this.theme = this.isDarkMode ? THEME.DARK : THEME.LIGHT;
    document?.documentElement?.classList?.add(this.theme);

    // Each surface is identified deterministically by a URL marker, never by a
    // viewport measurement. The action popup loads bare `index.html` (from the
    // manifest `default_popup`), the side panel is opened with `?sidepanel=true`,
    // and the expanded full-tab view is opened with `?tab=true` (APP_TAB_FILE).
    // The old first-paint height heuristic mis-flagged the popup as a tab when
    // the measurement landed after Chrome had already grown the popup document,
    // leaving it rendered with `h-screen` instead of the fixed 600px popup size.
    const urlParams = new URLSearchParams(window.location.search);
    this.isSidePanel = urlParams.has("sidepanel");
    const isTab = urlParams.has("tab");
    this.isPopupWindow = !this.isSidePanel && !isTab;

    this.#loadSettings();
  }

  async #loadSettings() {
    const settings = await StorageUtil.getSettings();
    runInAction(() => {
      if (settings.themePreference) {
        this.themePreference = settings.themePreference;
        this.#applyTheme(settings.themePreference);
      }
      if (settings.autoLockMinutes !== undefined) {
        this.autoLockMinutes = settings.autoLockMinutes;
      }
      if (settings.currency) {
        this.currency = settings.currency;
      }
      if (settings.language) {
        this.language = settings.language;
        i18n.changeLanguage(settings.language);
      }
      if (settings.defaultGasTier) {
        this.defaultGasTier = settings.defaultGasTier;
      }
      if (settings.showBalanceAndPrice !== undefined) {
        this.showBalanceAndPrice = settings.showBalanceAndPrice;
      }
      if (settings.notificationsEnabled !== undefined) {
        this.notificationsEnabled = settings.notificationsEnabled;
      }
      if (settings.phishingDetectionEnabled !== undefined) {
        this.phishingDetectionEnabled = settings.phishingDetectionEnabled;
      }
      this.sidePanelSurface = settings.sidePanelSurface;
      this.sidePanelPreferred = resolveSidePanelPreferred(settings);
      this.sidePanelNoticePending = settings.sidePanelNoticePending === true;
      this.sidePanelNoticeSeen = settings.sidePanelNoticeSeen === true;
    });
  }

  #applyTheme(pref: ThemePreference) {
    const root = document?.documentElement;
    if (!root) return;

    root.classList.remove(THEME.DARK, THEME.LIGHT);

    let resolved: string;
    if (pref === "system") {
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? THEME.DARK
        : THEME.LIGHT;
    } else {
      resolved = pref;
    }

    root.classList.add(resolved);
    this.theme = resolved;
    this.isDarkMode = resolved === THEME.DARK;
  }

  async #persistSettings() {
    await StorageUtil.setSettings({
      themePreference: this.themePreference,
      autoLockMinutes: this.autoLockMinutes,
      currency: this.currency,
      language: this.language,
      defaultGasTier: this.defaultGasTier,
      showBalanceAndPrice: this.showBalanceAndPrice,
      // Kept in sync so a downgrade to an older build still reads a sane
      // value. The surface decision itself uses sidePanelSurface.
      sidePanelPreferred: this.sidePanelPreferred,
      sidePanelSurface: this.sidePanelSurface,
      sidePanelNoticePending: this.sidePanelNoticePending,
      sidePanelNoticeSeen: this.sidePanelNoticeSeen,
      notificationsEnabled: this.notificationsEnabled,
      phishingDetectionEnabled: this.phishingDetectionEnabled,
    });
  }

  async setThemePreference(pref: ThemePreference) {
    this.themePreference = pref;
    this.#applyTheme(pref);
    await this.#persistSettings();
  }

  async setAutoLockMinutes(minutes: number) {
    this.autoLockMinutes = minutes;
    await this.#persistSettings();
    browser.runtime
      .sendMessage({ name: LOCK_MANAGER_MESSAGES.UPDATE_AUTO_LOCK })
      .catch(() => {});
  }

  async setCurrency(currency: string) {
    this.currency = currency;
    await this.#persistSettings();
  }

  async setLanguage(language: string) {
    this.language = language;
    i18n.changeLanguage(language);
    await this.#persistSettings();
  }

  async setDefaultGasTier(tier: GasTier) {
    this.defaultGasTier = tier;
    await this.#persistSettings();
  }

  async setShowBalanceAndPrice(enabled: boolean) {
    this.showBalanceAndPrice = enabled;
    await this.#persistSettings();
  }

  async setNotificationsEnabled(enabled: boolean) {
    this.notificationsEnabled = enabled;
    await this.#persistSettings();
  }

  async setPhishingDetectionEnabled(enabled: boolean) {
    this.phishingDetectionEnabled = enabled;
    await this.#persistSettings();
  }

  /**
   * Records an explicit surface choice. Writing sidePanelSurface is what
   * distinguishes a real decision from the default, so the toolbar click and
   * the dApp approval path both follow the user from here on.
   */
  async setSidePanelPreferred(preferred: boolean) {
    this.sidePanelPreferred = preferred;
    this.sidePanelSurface = preferred ? "panel" : "popup";
    // The choice itself answers the notice.
    this.sidePanelNoticePending = false;
    this.sidePanelNoticeSeen = true;
    await this.#persistSettings();
    if (
      typeof chrome !== "undefined" &&
      typeof chrome?.sidePanel?.setPanelBehavior === "function"
    ) {
      try {
        await chrome.sidePanel.setPanelBehavior({
          openPanelOnActionClick: preferred,
        });
        if (preferred) {
          await chrome.sidePanel.setOptions({ path: SIDE_PANEL_PATH });
        }
      } catch {
        // sidePanel API may not be available in all browsers.
      }
    }
  }

  /** Clears the one-time migration notice without changing the surface. */
  async dismissSidePanelNotice() {
    this.sidePanelNoticePending = false;
    this.sidePanelNoticeSeen = true;
    await this.#persistSettings();
  }
}

export default SettingsStore;
