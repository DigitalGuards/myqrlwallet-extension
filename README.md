# MyQRLWallet for your browser

**Your wallet for QRL 2.0, one click away in the browser toolbar.** Hold and send Quanta, keep tokens and NFTs, and connect to dApps. Your keys stay on your device, and every transaction is signed with post-quantum cryptography.

**[Add to Chrome](https://chromewebstore.google.com/detail/cafpjgccpmfjefdfeldlhgmgbmpibdgg)** · [myqrlwallet.com](https://myqrlwallet.com) · [Step-by-step guide](https://myqrlwallet.com/guides/browser-extension/)

Works in Chrome, Brave, Edge and other Chromium browsers. MyQRLWallet currently runs on the QRL 2.0 test network.

## What you can do

- **Start in a minute.** Create a new wallet, or bring one you already have with its recovery phrase, hex seed or encrypted wallet file.
- **Send and receive Quanta.** Share your address as a QR code, save contacts, and follow each transfer in your history.
- **Keep tokens and NFTs.** Add QRC-20 tokens and NFT collections, see what you own, and send them from the same place.
- **Connect to dApps.** Sites find the wallet by themselves. You approve each connection, signature and transaction, and contract calls are shown in words you can check before you sign.
- **Use it your way.** Open it as a popup, keep it in the side panel next to the page, or give it a full tab. Light and dark themes follow your system, in English, German, Spanish, Russian and Chinese.

## You stay in control

- **Your keys stay on your device.** They are stored encrypted with your password and never leave your browser.
- **Post-quantum signatures.** Transactions and messages are signed with ML-DSA-87, a signature scheme designed to stay secure against quantum computers.
- **Locks by itself.** The wallet locks after a period without activity that you choose.
- **Warns about known scam sites** before you connect to them.
- **Checks the network** it talks to before it signs or sends anything.
- **No tracking.** The extension contains no analytics. It is open source, so anyone can check.

## Install

1. Open the [Chrome Web Store page](https://chromewebstore.google.com/detail/cafpjgccpmfjefdfeldlhgmgbmpibdgg) and press **Add to Chrome**.
2. Pin MyQRLWallet to your toolbar with the puzzle icon.
3. Open it, set a password, and create or import your account.

Updates arrive through the store by themselves.

## Keep your recovery phrase safe

Your recovery phrase is the only way to get your wallet back if you lose your device or forget your password. Write it down on paper and keep it somewhere private. Nobody from MyQRLWallet will ever ask you for it.

## What the extension connects to

- **A QRL 2.0 node**, to read your balances and send your transactions. You can add a network with your own node in the settings.
- **The ShorScan explorer**, for transaction history and for suggesting tokens and NFTs you own.
- **An IPFS gateway and the address an NFT names**, to load NFT pictures and descriptions.
- **A list of known scam sites**, refreshed from a public list.
- **A price service**, for the value of your balance in your currency once mainnet is live.

## More from MyQRLWallet

The same wallet is available on the [web](https://qrlwallet.com), as a [desktop app](https://github.com/DigitalGuards/myqrlwallet-desktop/releases/latest) and as a phone app for iPhone and Android. Find them all on [myqrlwallet.com](https://myqrlwallet.com).

## Help and security

- Guides: [myqrlwallet.com/guides](https://myqrlwallet.com/guides/)
- Found a bug or have an idea? [Open an issue](https://github.com/DigitalGuards/myqrlwallet-extension/issues).
- Found a security problem? Please report it privately: see the [security policy](SECURITY.md).

<details>
<summary><strong>For developers</strong></summary>

### Connecting your dApp

The wallet announces itself through EIP-6963 as `com.qrlwallet.extension` and injects a QRL 2.0 provider. Accounts are QRL 2.0 addresses: `Q` followed by 128 hexadecimal characters. A dApp gets access per origin and per chain, and only after the user approves. To support the extension together with the phone and desktop wallets, use [`@qrlwallet/connect`](https://github.com/DigitalGuards/myqrlwallet-connect).

### Build from source

Use Node.js 22 and npm.

```sh
git clone https://github.com/DigitalGuards/myqrlwallet-extension.git
cd myqrlwallet-extension
npm ci
npm run build
```

Open `chrome://extensions`, switch on Developer mode, choose **Load unpacked** and select the generated `Extension/` folder. `npm run dev` rebuilds it when source files change. Keep using the same folder for updates, so the unpacked extension keeps its identity and storage.

### Checks

```sh
node scripts/audit-gate.mjs
npm run lint
npm run lint:ratchet
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.node.json
npm test
```

CI runs the same checks, plus browser tests that drive the built extension in the popup, the side panel and a full tab. The audit gate blocks high and critical advisories in production dependencies unless a matching, unexpired exception is recorded in `audit-allowlist.json`.

### Release builds

Each [release](https://github.com/DigitalGuards/myqrlwallet-extension/releases) carries the packaged extension as a ZIP file. The Chrome Web Store version is built from the same tag.

</details>

## License and credits

MyQRLWallet for your browser is open source under the [MIT license](LICENSE). It is a fork of [theQRL/qrl-web3-wallet](https://github.com/theQRL/qrl-web3-wallet) by The Quantum Resistant Ledger, whose attribution and license are preserved. MyQRLWallet is built by [DigitalGuards](https://digitalguards.nl).
