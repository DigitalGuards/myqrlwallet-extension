import browser from "webextension-polyfill";
import { QRL_POST_MESSAGE_STREAM } from "../constants/streamConstants";
import { checkForLastError } from "./scriptUtils";

export const CONTENT_SCRIPT_KEEP_ALIVE_INTERVAL_MS = 3_000;

/**
 * Keeps the service worker responsive for a dApp tab with one small
 * runtime message per interval, the way MetaMask's content script does.
 *
 * This used to open a new runtime port on every tick and never close it,
 * so each open tab accumulated about 1,200 ports an hour on both sides.
 * When Chrome moved the page into the back/forward cache it closed them
 * all at once, and the service worker logged one "Unchecked
 * runtime.lastError" per port.
 *
 * The message carries no data and no activity meaning: the lock manager's
 * listener ignores senders outside extension pages, so it never re-arms
 * auto-lock and never reaches wallet state.
 */
export const startContentScriptKeepAlive = () =>
  setInterval(() => {
    browser.runtime
      .sendMessage({ name: QRL_POST_MESSAGE_STREAM.CONTENT_SCRIPT_KEEP_ALIVE })
      .catch(() => {
        // A worker between wake-ups answers nothing; the next tick retries.
        checkForLastError();
      });
  }, CONTENT_SCRIPT_KEEP_ALIVE_INTERVAL_MS);
