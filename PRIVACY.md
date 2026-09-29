# MyQRLWallet Extension Privacy Policy

Last updated: 29 September 2026

MyQRLWallet is a self-custody browser extension for the QRL 2.0 blockchain,
provided by DigitalGuards (eenmanszaak, Netherlands, KvK 91987482). It is
designed to process as little personal data as possible. This policy explains
what data the extension handles and why. For privacy questions, contact
security@digitalguards.nl.

## What stays on your device

The extension is non-custodial. Your recovery (seed) phrase and your ML-DSA-87
signature keys are generated and stored locally in the extension's own storage,
encrypted where you set a password. They are never transmitted to, or accessible
by, DigitalGuards. Your settings and any saved data also stay in local
extension storage.

## What we do not do

- No analytics, telemetry, crash reporting or usage tracking.
- No advertising or tracking cookies, and no profiling.
- No sale or sharing of your data for marketing.
- We never receive your recovery phrase or private keys.

## Data processed when you use the extension

Using the extension involves some network requests that necessarily reveal your
IP address to the endpoints they reach. We do not combine this data to identify
you.

- **Blockchain access:** to read balances and broadcast transactions that you
  have signed locally, the extension contacts the configured RPC endpoint. That
  endpoint observes your IP address and the public address you query. By default
  this is the DigitalGuards RPC proxy; see the wallet Privacy Policy at
  https://qrlwallet.com/privacy for how it is handled.
- **Phishing protection:** roughly once every 24 hours the extension fetches an
  up-to-date phishing-domain blocklist from GitHub
  (`https://raw.githubusercontent.com/MetaMask/eth-phishing-detect`). This is a
  plain request for a public file; no wallet data is sent, but the request
  reveals your IP address to GitHub. A bundled copy is used as a fallback.
- **Balances, history, tokens and NFTs:** the extension asks the ZondScan block
  explorer (zondscan.com, operated by DigitalGuards) for transaction history and
  for the tokens and NFTs held by the addresses you view. The explorer observes
  your IP address and those public addresses.
- **Prices:** while the wallet is unlocked and balance and price display is
  switched on, the extension asks CoinGecko (`api.coingecko.com`) for the current
  QRL market price about once a minute. No wallet data is sent; the request
  reveals your IP address to CoinGecko. When CoinGecko refuses or fails the
  request, the extension asks the ZondScan block explorer (zondscan.com,
  operated by DigitalGuards) for the same price instead, again without sending
  any wallet data. You can switch this off in the settings.
- **NFT content:** NFT metadata and images stored on IPFS are loaded through the
  qrlwallet.com gateway, with the public ipfs.io gateway as a fallback. NFT images
  that their creators host on an ordinary web address are loaded from that
  address, so the server chosen by the creator sees your IP address and which
  image was requested.
- **Networks you add:** if you add your own network, or approve a network that a
  dApp proposes, that network's requests (including the public addresses you
  query and the transactions you broadcast there) go straight to the RPC endpoint
  you chose, whose operator handles them under its own policy.
- **dApp connections:** when you pair with a decentralised application, the
  connection is brokered by an end-to-end-encrypted relay. The relay routes
  ciphertext only and cannot read your messages.

## Your rights

To the extent we process your personal data, you have the rights of access,
rectification, erasure, restriction, objection and portability under the GDPR.
Contact security@digitalguards.nl to exercise them. You may also lodge a
complaint with the Dutch supervisory authority, the Autoriteit Persoonsgegevens,
or with the supervisory authority of your country of residence.

## Changes

We may update this policy and will change the "Last updated" date above.
