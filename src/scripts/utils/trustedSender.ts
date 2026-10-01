import browser from "webextension-polyfill";

/**
 * Whether a runtime message or port came from this extension's own UI.
 *
 * The only legitimate callers are same-extension code running in an
 * extension-origin document (popup, options, side panel, approval window)
 * or the service worker's own context messaging itself. Both report a
 * `sender.id` equal to this extension's own id and a `sender.url` under the
 * extension's own origin.
 *
 * Everything else fails closed: an undefined sender, a different
 * extension's id, and above all a content script, which reports the page's
 * origin in `sender.url` and must never be able to pose as the approval
 * surface. Extracted from lockManager.ts so the approval middleware applies
 * the same rule to the messages and ports that resolve a dApp request.
 */
export const isTrustedExtensionSender = (
  sender?: browser.Runtime.MessageSender,
): boolean => {
  if (sender === undefined) return false;
  if (typeof sender.id !== "string" || sender.id !== browser.runtime.id) {
    return false;
  }
  if (typeof sender.url !== "string") return false;
  return sender.url.startsWith(browser.runtime.getURL(""));
};
