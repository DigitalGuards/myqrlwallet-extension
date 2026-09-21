# MyQRLWallet Extension

MyQRLWallet is a Chromium browser extension for the QRL v3 Private testnet. Version 1.1.0 uses QIP-55 addresses: uppercase `Q` followed by 128 hexadecimal characters.

The default testnet has chain ID `3151909` (`0x301825`). The extension verifies its genesis before signing or broadcasting. This release is for testnet use.

## Existing wallets

V3 uses separate storage for accounts, encrypted keys, settings, permissions and pending approvals. Your existing v2 records remain stored when you create, import or reset a v3 wallet. V2 accounts are not automatically converted into v3 accounts.

Create a new v3 account or explicitly import a recovery phrase, hex seed or encrypted wallet backup. Importing the same seed for v3 derives its 64-byte address. Keep a backup of any existing wallet before replacing an unpacked extension.

## Install

1. Download `myqrlwallet-extension-v1.1.0.zip` from the [DigitalGuards release page](https://github.com/DigitalGuards/myqrlwallet-extension/releases/latest).
2. Extract the ZIP into a dedicated folder.
3. Open `chrome://extensions` and enable Developer mode.
4. Choose Load unpacked and select the folder containing `manifest.json`.

Use the same extracted folder for updates to preserve the unpacked extension's identity and storage. Chrome Web Store distribution is pending.

## Build and verify

Use Node.js 22 and npm.

```sh
git clone https://github.com/DigitalGuards/myqrlwallet-extension.git
cd myqrlwallet-extension
npm ci
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Load the generated `Extension/` directory in your browser. `npm run dev` rebuilds it when source files change.

Browser tests exercise the built extension, including popup, side panel, expanded tab, account import, provider discovery, permission changes and service-worker restart recovery. The composition test uses the exact QuantaSwap revision pinned in CI.

## Capabilities

- Create and import QIP-55 accounts, with encrypted local keystores and recovery backups.
- Send native testnet Quanta with exact decimal amount handling.
- Display, reveal and copy full 64-byte addresses.
- Discover accounts through EIP-6963 and authorize dApps by origin and chain.
- Sign post-quantum messages with ML-DSA-87.
- Expose `qrl_walletCapabilities` without account permission. It reports the address scheme, chain ID and verified genesis. Account access continues to require user consent.

Typed-data signing remains unavailable until a versioned 64-byte layout is qualified. Ledger support requires explicit QIP-55 device capability. Existing v2 dApps may reject 64-byte accounts and require their own protocol upgrade. Token, NFT and naming integrations require compatible v3 deployments.

## Attribution

This MIT-licensed project is a fork of [theQRL/qrl-web3-wallet](https://github.com/theQRL/qrl-web3-wallet). Upstream attribution and [LICENSE](LICENSE) are preserved.
