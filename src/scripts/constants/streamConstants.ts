// Page-visible channel names. Deliberately NOT the upstream "qrl-wallet-*"
// values: WindowPostMessageStream rides the shared window.postMessage bus,
// so if this fork and the upstream QRL Web3 Wallet use the same names, each
// extension's content script relays the other's provider traffic and a
// single dApp request spawns approval popups in BOTH extensions.
export const QRL_WALLET_PROVIDER_NAME = "myqrlwallet-provider";

export const EXTENSION_MESSAGES = {
  CONNECTION_READY: "QRL_WALLET_CONNECTION_READY",
  READY: "QRL_WALLET_EXTENSION_READY",
  DAPP_RESPONSE: "QRL_WALLET_DAPP_RESPONSE",
  // Side-panel gesture roundtrip. The service worker asks the requesting tab
  // for its user activation, and the frame that holds it answers; see
  // scripts/utils/sidePanelSurface.ts.
  REQUEST_OPEN_SIDE_PANEL: "QRL_WALLET_REQUEST_OPEN_SIDE_PANEL",
  OPEN_SIDE_PANEL: "QRL_WALLET_OPEN_SIDE_PANEL",
} as const;

export const QRL_POST_MESSAGE_STREAM = {
  INPAGE: "myqrlwallet-in-page",
  CONTENT_SCRIPT: "myqrlwallet-content-script",
  CONTENT_SCRIPT_KEEP_ALIVE: "myqrlwallet-content-script-keep-alive",
} as const;

// Per-request lifecycle port. The popup connects this port while a dApp
// approval surface is mounted; if the port disconnects before the popup
// posts a DAPP_RESPONSE, the middleware treats it as a user rejection.
export const DAPP_REQUEST_PORT_NAME = "qrl-wallet-dapp-request";

// EIP-6963 identity of the MyQRLWallet extension. Minted 2026-07-09 under
// the qrlwallet.com namespace we control, alongside the relay's
// com.qrlwallet.connect. The display name is deliberately NOT plain
// "MyQRLWallet": the connect SDK announces that name for QR/relay pairing,
// and two identical rows in a dApp picker would be indistinguishable.
// Ecosystem dApps accept both this rdns and the original theqrl.org.
export const QRL_WEB3_WALLET_PROVIDER_INFO = {
  NAME: "MyQRLWallet Extension",
  RDNS: "com.qrlwallet.extension",
  ICON: "data:image/png;base64,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",
} as const;
