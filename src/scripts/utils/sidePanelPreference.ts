import type { WalletSettings } from "@/utilities/storageUtil";

// The side panel loads the wallet with a URL marker so settingsStore can
// classify the surface (see settingsStore's constructor).
export const SIDE_PANEL_PATH = "index.html?sidepanel=true";

/**
 * True when this browser can open the side panel programmatically. Firefox
 * and older Chromium builds have no chrome.sidePanel, and the whole feature
 * degrades to the popup behaviour the wallet shipped before.
 */
export const isSidePanelSupported = (): boolean =>
  typeof chrome !== "undefined" && typeof chrome.sidePanel?.open === "function";

/**
 * The side panel is the wallet's default surface. An unset preference
 * resolves to the panel; only an explicit "Open as popup" choice
 * (settings.sidePanelSurface === "popup", written by
 * settingsStore.setSidePanelPreferred) opts back out.
 *
 * The legacy boolean `sidePanelPreferred` is deliberately NOT consulted for
 * the decision. Older builds re-persisted it on every unrelated settings
 * write, so a stored `false` does not mean the user ever asked for the
 * popup. Those users land on the panel and get the one-time notice with an
 * inline switch back.
 */
export const resolveSidePanelPreferred = (
  settings: WalletSettings,
  supported: boolean = isSidePanelSupported(),
): boolean => {
  if (!supported) {
    return false;
  }
  return settings.sidePanelSurface !== "popup";
};
