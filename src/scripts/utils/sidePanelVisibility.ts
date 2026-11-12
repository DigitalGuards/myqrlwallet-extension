import { isRecord } from "@/utilities/storageGuards";
import browser from "webextension-polyfill";
import { EXTENSION_MESSAGES } from "../constants/streamConstants";
import { mintNonce } from "./mintNonce";
import { isTrustedExtensionSender } from "./trustedSender";

// How long the worker waits for the panel pages to answer. A panel that is
// silent for this long counts as showing, which keeps the behaviour of a
// browser or panel that never learned the probe.
export const SIDE_PANEL_PROBE_TIMEOUT_MS = 300;

export type SidePanelReport = {
  visible: boolean;
  windowId: number | undefined;
};

type PendingProbe = {
  expected: number;
  reports: SidePanelReport[];
  finish: () => void;
};

const pendingProbes = new Map<string, PendingProbe>();

const isSidePanelUrl = (url: string | undefined): boolean => {
  if (url === undefined) return false;
  try {
    return new URL(url).searchParams.has("sidepanel");
  } catch {
    return false;
  }
};

/**
 * Service-worker half of the probe: collects one report per panel page.
 * Only the wallet's own side panel page may report: a content script, a
 * foreign extension or another wallet surface is ignored. Never returns a
 * value to the messaging layer, so no other listener is starved.
 */
export const handleSidePanelVisibilityMessage = (
  message: unknown,
  sender: browser.Runtime.MessageSender,
): boolean => {
  if (
    !isRecord(message) ||
    message.name !== EXTENSION_MESSAGES.SIDE_PANEL_VISIBILITY
  ) {
    return false;
  }
  const { nonce, visible, windowId } = message;
  if (typeof nonce !== "string" || typeof visible !== "boolean") return false;
  if (!isTrustedExtensionSender(sender) || sender.tab !== undefined) {
    return false;
  }
  if (!isSidePanelUrl(sender.url)) return false;
  const entry = pendingProbes.get(nonce);
  if (!entry) return false;
  entry.reports.push({
    visible,
    windowId: typeof windowId === "number" ? windowId : undefined,
  });
  if (entry.reports.length >= entry.expected) entry.finish();
  return true;
};

let reportListenerRegistered = false;

const registerReportListener = (): void => {
  if (reportListenerRegistered) return;
  reportListenerRegistered = true;
  browser.runtime.onMessage.addListener((message, sender) => {
    handleSidePanelVisibilityMessage(message, sender);
  });
};

/**
 * Asks every live side panel page whether it is showing. Resolves with the
 * reports that arrived, which holds fewer entries than `expected` when a page
 * stayed silent for the timeout. Never rejects.
 */
export const probeSidePanels = async (
  expected: number,
): Promise<SidePanelReport[]> => {
  if (expected < 1) return [];
  registerReportListener();
  const nonce = mintNonce();
  return new Promise<SidePanelReport[]>((resolve) => {
    const reports: SidePanelReport[] = [];
    const timer = setTimeout(finish, SIDE_PANEL_PROBE_TIMEOUT_MS);
    function finish() {
      clearTimeout(timer);
      pendingProbes.delete(nonce);
      resolve(reports);
    }
    pendingProbes.set(nonce, { expected, reports, finish });
    browser.runtime
      .sendMessage({ name: EXTENSION_MESSAGES.PROBE_SIDE_PANEL, nonce })
      .catch(finish);
  });
};

/**
 * Decides from the reports whether the wallet's panel is live but hidden in
 * the window of the requesting tab. Anything unclear (a silent panel, a
 * visible one, a panel in another window) answers false, so the caller keeps
 * its earlier behaviour.
 */
export const isPanelHiddenInWindow = (
  reports: readonly SidePanelReport[],
  expected: number,
  windowId: number | undefined,
): boolean =>
  windowId !== undefined &&
  reports.length >= expected &&
  reports.every((report) => !report.visible) &&
  reports.some((report) => report.windowId === windowId);

/**
 * Panel-page half: answers the worker's probe with this page's visibility
 * state and window. Registered by the side panel surface only.
 */
export const registerSidePanelVisibilityResponder = (): void => {
  browser.runtime.onMessage.addListener((message, sender) => {
    if (
      !isRecord(message) ||
      message.name !== EXTENSION_MESSAGES.PROBE_SIDE_PANEL ||
      typeof message.nonce !== "string"
    ) {
      return;
    }
    // Only the wallet's own worker asks: an extension page, never a tab.
    if (!isTrustedExtensionSender(sender) || sender.tab !== undefined) return;
    const { nonce } = message;
    browser.windows
      .getCurrent()
      .then((current) =>
        browser.runtime.sendMessage({
          name: EXTENSION_MESSAGES.SIDE_PANEL_VISIBILITY,
          nonce,
          visible: document.visibilityState === "visible",
          windowId: current.id,
        }),
      )
      .catch(() => {
        // Best effort: a silent panel counts as showing.
      });
  });
};

// Test seam: module state outlives a single case.
export const resetSidePanelVisibilityForTests = (): void => {
  for (const entry of [...pendingProbes.values()]) entry.finish();
  reportListenerRegistered = false;
};
