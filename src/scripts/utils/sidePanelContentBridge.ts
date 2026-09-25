import browser from "webextension-polyfill";
import { EXTENSION_MESSAGES } from "../constants/streamConstants";

/**
 * Content-script half of the side-panel gesture roundtrip.
 *
 * The service worker cannot call chrome.sidePanel.open() on its own: Chrome
 * requires a live user gesture, and a dApp RPC arrives in the worker without
 * one. So the worker asks the requesting tab, and the frame that still holds
 * the gesture answers; the worker then opens the panel synchronously in its
 * message handler.
 *
 * Returns true when this frame answered, which keeps the behaviour testable
 * without reaching into the messaging mocks.
 */
export const handleSidePanelOpenRequest = (
  message: unknown,
  sender?: browser.Runtime.MessageSender,
): boolean => {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const { name, nonce } = message as Record<string, unknown>;
  if (name !== EXTENSION_MESSAGES.REQUEST_OPEN_SIDE_PANEL) {
    return false;
  }
  if (typeof nonce !== "string" || nonce.length === 0) {
    return false;
  }
  // Chrome routes other extensions to onMessageExternal; this check is a
  // second fence behind that routing.
  if (sender?.id !== undefined && sender.id !== browser.runtime.id) {
    return false;
  }
  // The worker broadcasts to every frame in the tab. Only the frame the user
  // actually clicked in carries the activation, and only that frame may
  // answer: any other frame would either fail or open the panel off a
  // gesture the user never gave to it.
  if (!navigator.userActivation?.isActive) {
    return false;
  }

  browser.runtime
    .sendMessage({
      name: EXTENSION_MESSAGES.OPEN_SIDE_PANEL,
      nonce,
    })
    .catch(() => {
      // The worker falls back to the popup surface on its own timeout.
    });
  return true;
};
