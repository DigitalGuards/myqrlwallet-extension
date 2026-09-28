import { profileStorageKey } from "@/utilities/profileStorage";
import StorageUtil from "@/utilities/storageUtil";
import { JsonRpcEngine } from "@theqrl/qrl-wallet-provider/json-rpc-engine";
import { createEngineStream } from "@theqrl/qrl-wallet-provider/json-rpc-middleware-stream";
import { ExtensionPortStream } from "extension-port-stream";
import { pipeline } from "readable-stream";
import browser from "webextension-polyfill";
import {
  EXTENSION_MESSAGES,
  QRL_POST_MESSAGE_STREAM,
  QRL_WALLET_PROVIDER_NAME,
} from "./constants/streamConstants";
import LockManager, { LOCK_MANAGER_MESSAGES } from "./lockManager/lockManager";
import { appendSenderDataMiddleware } from "./middlewares/appendSenderDataMiddleware";
import { blockUnSupportedMethodsMiddleware } from "./middlewares/blockUnSupportedMethodsMiddleware";
import { restrictedMethodsMiddleware } from "./middlewares/restrictedMethodsMiddleware";
import { unrestrictedMethodsMiddleware } from "./middlewares/unrestrictedMethodsMiddleware";
import {
  DAPP_TX_WATCH_ALARM_NAME,
  handleDAppTransactionWatchAlarm,
} from "./utils/dAppTransactionWatcher";
import {
  handlePhishingRefreshAlarm,
  initializePhishingDetector,
  PHISHING_ALARM_NAME,
  setupPhishingRefreshAlarm,
} from "./phishing/phishingDetector";
import { checkForLastError } from "./utils/scriptUtils";
import { setupMultiplex } from "./utils/streamUtils";
import {
  notifyDAppAccountsChanged,
  registerDAppAccountNotificationStream,
} from "./utils/dAppAccountNotifications";
import { initializeContentScriptProviderConnection } from "./utils/providerConnectionLifecycle";
import {
  applyEarlySidePanelToolbarBehavior,
  applySidePanelToolbarBehavior,
  handleSidePanelInstalled,
  registerSidePanelOpenListener,
} from "./utils/sidePanelSurface";

// Resolved once initializeServiceWorker()'s async setup (side panel
// reconciliation, content-script registration, phishing detector init)
// finishes. Event listeners themselves are ALWAYS registered synchronously,
// below, before that setup even starts - this promise exists purely for a
// handler's own internal logic to wait on async-initialized state without
// ever risking the event itself being dropped (the listener is already
// attached and will fire regardless of whether this has resolved yet).
let markServiceWorkerReady: () => void = () => {};
const serviceWorkerReady = new Promise<void>((resolve) => {
  markServiceWorkerReady = resolve;
});

// Backstop for the await below (H1, PR #71 audit): initializeServiceWorker()
// guarantees markServiceWorkerReady() always runs (see its own try/finally),
// and every individual startup step is now failure-tolerant on top of that,
// so nothing should ever actually hit this timeout. It exists purely so a
// future startup step that hangs some other way (not a rejection, an
// await that never settles) can never wedge a content-script connection
// indefinitely.
const SERVICE_WORKER_READY_TIMEOUT_MS = 10_000;
const waitForServiceWorkerReady = (): Promise<void> =>
  Promise.race([
    serviceWorkerReady,
    new Promise<void>((resolve) =>
      setTimeout(resolve, SERVICE_WORKER_READY_TIMEOUT_MS),
    ),
  ]);

// Registered here, synchronously, at module evaluation: MV3 requires an
// alarm listener to be attached before the script's first `await`, or an
// alarm firing during a cold start can be missed entirely. QRL_AUTO_LOCK
// used to be handled by a second listener registered inside
// prepareListeners(), which sits behind the `await
// applyEarlySidePanelToolbarBehavior()` in initializeServiceWorker() below;
// an alarm that woke a cold SW could fire and be dropped before that
// listener ever attached, and since QRL_AUTO_LOCK is a one-shot alarm
// nothing would ever recreate it, leaving the wallet unlocked indefinitely.
// All alarm handling now lives here, dispatched by name. The keep-alive
// alarm this used to also dispatch is gone: keeping the worker alive is
// now an in-worker setInterval (LockManager.startKeepAliveInterval),
// started directly on unlock.
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DAPP_TX_WATCH_ALARM_NAME) {
    handleDAppTransactionWatchAlarm();
  } else if (alarm.name === LockManager.AUTO_LOCK_ALARM) {
    LockManager.handleAutoLockAlarm();
  } else if (alarm.name === PHISHING_ALARM_NAME) {
    handlePhishingRefreshAlarm();
  }
});

type ContentScriptType = browser.Scripting.RegisteredContentScript;

const registerScripts = async () => {
  const previouslyRegisteredScriptIds = (
    await browser.scripting.getRegisteredContentScripts()
  ).map((script) => script.id);
  const contentScripts: ContentScriptType[] = [
    {
      id: "qrlInPageScript",
      matches: ["<all_urls>"],
      js: ["src/scripts/inPageScript.js"],
      runAt: "document_start",
      allFrames: true,
      // @ts-expect-error - webextension-polyfill types do not include the "world" property for content scripts
      // This is important. The script must run in the "MAIN" world,
      // so that the qrl provider will be available browser wide, not just isolated to the extension.
      world: "MAIN",
    },
  ];

  // This registers the in-page script to browser pages, if not already done.
  // "MAIN" world does not work if this script was invoked from manifest file instead.
  await browser.scripting.registerContentScripts(
    contentScripts.filter(
      (script) => !previouslyRegisteredScriptIds.includes(script.id),
    ),
  );
};

// None of these need to wait on serviceWorkerReady: the badge display just
// reads storage, lockManagerListener only ever touches LockManager's own
// in-memory state plus browser.storage (already safe by the time any
// listener can even be registered), the side-panel gesture roundtrip and
// onInstalled notice are independent of the rest of setup, and the
// SEND_TX_NOTIFICATION handler only reads settings and calls the
// notifications API. They are registered synchronously here purely so a
// message that wakes a dormant worker always finds a listener already
// attached - see the module-level comment above serviceWorkerReady.
const prepareListeners = () => {
  // Listening to storage for displaying the badge in the extension.
  browser.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === "local") {
      notifyDAppAccountsChanged(changes[profileStorageKey("DAPPS")]);
    }
    const storedDAppRequestData = await StorageUtil.getDAppsRequestData();
    if (storedDAppRequestData) {
      // If there is a pending request, the badge with 1 notification will be displayed.
      browser.action.setBadgeText({ text: "1" });
      browser.action.setBadgeBackgroundColor({ color: "#4AAFFF" });
    } else {
      browser.action.setBadgeText({ text: "" });
    }
  });
  // Listening for messages related to the wallet locking.
  browser.runtime.onMessage.addListener(LockManager.lockManagerListener);
  // Side-panel gesture roundtrip. Registered early so a request that arrives
  // right after a cold start still finds its listener.
  registerSidePanelOpenListener();
  // Existing installs move to the side panel and get the one-time notice.
  browser.runtime.onInstalled.addListener((details) => {
    handleSidePanelInstalled(details.reason).catch(() => {
      // Best effort: a failed notice flag must not break the install.
    });
  });
  // Listening for transaction notification requests from the popup.
  // IMPORTANT: Must NOT be async. Returning a Promise from onMessage claims the
  // message channel and prevents lockManagerListener from responding.
  browser.runtime.onMessage.addListener((message) => {
    if (message.name !== LOCK_MANAGER_MESSAGES.SEND_TX_NOTIFICATION) {
      return;
    }
    (async () => {
      const settings = await StorageUtil.getSettings();
      if (
        !settings.notificationsEnabled &&
        settings.notificationsEnabled !== undefined
      ) {
        return;
      }
      const { status, amount, tokenSymbol, txHash } = message.data ?? {};
      const isConfirmed = status === "confirmed";
      const title = isConfirmed
        ? "Transaction Confirmed"
        : "Transaction Failed";
      const body =
        amount !== undefined && tokenSymbol
          ? `Your transaction of ${amount} ${tokenSymbol} ${isConfirmed ? "was confirmed" : "failed"}.`
          : `Your transaction ${isConfirmed ? "was confirmed" : "failed"}.`;
      try {
        await browser.notifications.create(`tx-${txHash ?? Date.now()}`, {
          type: "basic",
          iconUrl: browser.runtime.getURL("icons/qrl/48.png"),
          title,
          message: body,
        });
      } catch (error) {
        console.error("QrlWeb3Wallet: Failed to create notification:", error);
      }
    })();
  });
};

/**
 * Sends a message to the dapp(s) content script to signal it can connect to the background as
 * the backend is not active. It is required to re-connect dapps after service worker re-activates.
 * For non-dapp pages, the message will be sent and ignored.
 */
const announceServiceWorkerReady = async () => {
  const tabs = await browser.tabs.query({
    url: "<all_urls>",
    windowType: "normal",
  });

  for (const tab of tabs) {
    browser.tabs
      .sendMessage(tab.id ?? 0, {
        name: EXTENSION_MESSAGES.READY,
      })
      .then(() => {
        checkForLastError();
      })
      .catch(() => {
        // Expected for tabs without our content script (e.g. other extensions, chrome:// pages).
        checkForLastError();
      });
  }
};

/**
 * A method for creating a qrl provider.
 * Middlewares are pushed to the engine here.
 */
const setupProviderEngineEip1193 = ({
  sender,
}: {
  sender: browser.Runtime.MessageSender;
}) => {
  const engine = new JsonRpcEngine();

  // If the requested method is not supported, this ends the request.
  engine.push(blockUnSupportedMethodsMiddleware);
  // Appends the sender details to the request.
  engine.push(appendSenderDataMiddleware({ sender }));
  // Handles the unrestricted method calls without requiring user's approval
  engine.push(unrestrictedMethodsMiddleware);
  // Handles the dApp's connect wallet functionality
  engine.push(restrictedMethodsMiddleware);

  return engine;
};

/**
 * A method for serving qrl provider over a given stream.
 */
const setupProviderConnectionEip1193 = async (port: browser.Runtime.Port) => {
  const portStream = new ExtensionPortStream(port);
  const mux = setupMultiplex(portStream);
  const outStream = mux.createStream(QRL_WALLET_PROVIDER_NAME);
  const sender = port.sender;
  const unregisterAccountNotifications = registerDAppAccountNotificationStream(
    sender ?? {},
    outStream,
  );
  port.onDisconnect.addListener(unregisterAccountNotifications);

  // messages between inpage and background
  const engine = setupProviderEngineEip1193({
    // @ts-expect-error - port.sender may be undefined but is always present for content script connections
    sender,
  });
  // setup connection
  const providerStream = createEngineStream({ engine });

  pipeline(outStream, providerStream, outStream, (err) => {
    unregisterAccountNotifications();
    console.warn("QrlWeb3Wallet: Error in stream pipeline\n", err);
    // handle any middleware cleanup
    // @ts-expect-error - _middleware is a private property on JsonRpcEngine not exposed in type definitions
    engine?._middleware?.forEach((mid: { destroy?: () => void }) => {
      if (mid.destroy && typeof mid.destroy === "function") {
        mid.destroy();
      }
    });
  });

  port.postMessage({ name: EXTENSION_MESSAGES.CONNECTION_READY });
};

const establishContenScriptConnection = () => {
  browser.runtime.onConnect.addListener(async (port) => {
    // Ensuring the port connected to is the content script
    if (port.name === QRL_POST_MESSAGE_STREAM.CONTENT_SCRIPT) {
      // The connection event itself is never dropped - this listener is
      // registered synchronously at module evaluation, before
      // initializeServiceWorker() runs at all. Waiting here delays only
      // the work inside the handler, until the phishing detector (used by
      // restrictedMethodsMiddleware for every dApp request) and the rest
      // of setup have actually finished, so the provider engine wired up
      // below always has a ready phishing verdict to give. Racing against
      // a timeout (see its own comment) still lets this connection proceed
      // even if a future startup step somehow hangs.
      await waitForServiceWorkerReady();
      await initializeContentScriptProviderConnection(
        port,
        setupProviderConnectionEip1193,
        announceServiceWorkerReady,
      );
    }
  });
};

const establishLockManagerConnection = () => {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === LOCK_MANAGER_MESSAGES.PORT) {
      port.postMessage({ name: LOCK_MANAGER_MESSAGES.IS_LOCK_MANAGER_READY });
    }
  });
};

// Registered synchronously, at module evaluation, for the same reason as
// the alarms listener above: a message or port connect that wakes a
// dormant worker (the lockStore keep-alive port, the throttled activity
// ping, IS_LOCKED, ENCRYPT_ACCOUNT, a dApp's content-script connection)
// used to arrive before initializeServiceWorker() had gotten past its
// first `await` (applyEarlySidePanelToolbarBehavior()), where these were
// previously registered - with zero listeners attached yet, Chrome drops
// the event and the caller sees "Receiving end does not exist" /
// "Could not establish connection", exactly the console error a real-device
// side-panel test surfaced. All three calls below are synchronous
// (addListener only); none of them wait on anything async themselves.
prepareListeners();
establishContenScriptConnection();
establishLockManagerConnection();

const enforceSessionStorageAccessLevel = async () => {
  // Pin session storage to TRUSTED_CONTEXTS so content scripts cannot read
  // it (it only ever holds the non-secret keep-alive timestamp and pending
  // dApp-request bookkeeping, but the fence stays regardless).
  // TRUSTED_CONTEXTS is the MV3 default; we set it explicitly so a future
  // Chromium default change cannot quietly widen us.
  try {
    await chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_CONTEXTS",
    });
  } catch {
    // Older Chromium versions lack the API; the default already excludes
    // content scripts so the wallet remains safe.
  }
};

// Runs one startup step without letting its failure stop the steps after
// it (H1): each step below is independent (side-panel setup, the legacy
// scrub, content-script registration, phishing detection all touch
// unrelated state), so one throwing must not skip the rest. Logged, not
// swallowed silently, so a real regression still shows up in the SW
// console.
const runStartupStep = async (
  label: string,
  step: () => Promise<unknown> | unknown,
): Promise<void> => {
  try {
    await step();
  } catch (error) {
    console.warn(`QrlWeb3Wallet: Startup step "${label}" failed`, error);
  }
};

const initializeServiceWorker = async () => {
  // All event listeners (alarms, runtime.onMessage, runtime.onConnect,
  // storage.onChanged, runtime.onInstalled) are already registered above,
  // synchronously, before this function's first `await` even runs. Nothing
  // below this point registers a listener - it is all one-time async setup.
  try {
    // Before anything else: the toolbar click that woke this worker may be
    // moments away, and Chrome uses the manifest `default_popup` until the
    // panel behaviour is set.
    await runStartupStep(
      "applyEarlySidePanelToolbarBehavior",
      applyEarlySidePanelToolbarBehavior,
    );

    await runStartupStep(
      "enforceSessionStorageAccessLevel",
      enforceSessionStorageAccessLevel,
    );

    // Startup hygiene: an older build may have left a plaintext key backup
    // in storage.session (removed entirely as of this version - see
    // LockManager's class doc comment), or an alarm from the removed
    // keep-alive-alarm design. Both are best-effort and harmless if there
    // is nothing to clean up.
    await runStartupStep("scrubLegacySessionSecrets", () =>
      LockManager.scrubLegacySessionSecrets(),
    );
    await runStartupStep("clear legacy QRL_KEEP_ALIVE alarm", () =>
      browser.alarms.clear("QRL_KEEP_ALIVE"),
    );

    await runStartupStep("registerScripts", registerScripts);

    // Reconcile: applies the persisted preference and pins the panel path.
    await runStartupStep(
      "applySidePanelToolbarBehavior",
      applySidePanelToolbarBehavior,
    );

    // Initialize phishing detection. initializePhishingDetector() itself
    // never rejects (H1: every blocklist source it can draw from is
    // validated and guarded independently); this wrapper adds a second,
    // independent layer of defence in depth around a bad blocklist and a
    // hung serviceWorkerReady.
    await runStartupStep(
      "initializePhishingDetector",
      initializePhishingDetector,
    );
    await runStartupStep(
      "setupPhishingRefreshAlarm",
      setupPhishingRefreshAlarm,
    );
  } finally {
    // Unblocks the content-script connection handler above; see
    // serviceWorkerReady's module-level comment. In a `finally` so it
    // always runs exactly once, no matter which step above failed or
    // whether one was ever added later without its own guard (H1).
    markServiceWorkerReady();
  }
};

// This is the starting point of service worker of qrl web3 wallet.
// This file is set as an entry in the "background" section of the manifest file.
initializeServiceWorker();
