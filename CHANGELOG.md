## Unreleased

### Security

- Include the wallet descriptor in post-quantum signing responses so SDK verifiers can bind the public key to the claimed Q-address.

### Fixed

- Refuse add-network and typed-data signing requests the approval prompt cannot read with an invalid-params error before any prompt opens, and parse the typed-data payload before the seed is decrypted.
- Read the call data of a dApp transaction that names it `input` (as contract calls made with `@theqrl/web3` do), so such a call is shown and signed as the contract call it is; a request whose `data` and `input` differ is refused with an invalid-params error before any prompt opens.
- Sign a dApp transaction that names no type as type 0x2 with the wallet's own fee values, and refuse another transaction type with an invalid-params error before any prompt opens.
- Stop reading an unreachable explorer as an empty collection: a QRC-1155 or non-enumerable QRC-721 collection that only the explorer can list now says so with a Retry, and every explorer request gives up after eight seconds.
- Read name, symbol and standard of an explorer-suggested NFT collection from its contract before it is stored, and keep a contract that is not an NFT out of the wallet.
- Clean and cap text from explorers and contracts, count one token id once however it is spelled, and bound the rows read from one explorer response; explorer history rows need a real transaction hash and keep only QRL addresses as parties. The explorer history warning gets a Retry.

### Changed

- Use shorscan.com for explorer links, history, token and NFT discovery and the price fallback; a stored built-in testnet entry follows.

## [0.3.0](https://github.com/theQRL/qrl-web3-wallet/compare/v0.2.0...v0.3.0) (2026-05-07)

### Features

- close out CIPH-QRLW3-[1-33] ([#22](https://github.com/theQRL/qrl-web3-wallet/issues/22)) ([972695e](https://github.com/theQRL/qrl-web3-wallet/commit/972695e7ab0d6560d1143af4c2221fb5c38e6587))

## [0.2.0](https://github.com/theQRL/qrl-web3-wallet/compare/v0.1.1...v0.2.0) (2026-05-03)

### Features

- updates the zond web3 wallet ([#7](https://github.com/theQRL/qrl-web3-wallet/issues/7)) ([3efa6b1](https://github.com/theQRL/qrl-web3-wallet/commit/3efa6b145cb14b4349ec96c2bb4b1a75e74e4e46))

### Bug Fixes

- add validation for missing fields in ZND transfer request ([4910cc5](https://github.com/theQRL/qrl-web3-wallet/commit/4910cc5d1059586e18ed626e65cb53292fbf29be))
- adds dapp close option ([bd7b6ba](https://github.com/theQRL/qrl-web3-wallet/commit/bd7b6bad625501afa0109a00b0cb903b9aca5cbf))
- Ensure 'to' address is included in ZND transfers via extension ([de75cdc](https://github.com/theQRL/qrl-web3-wallet/commit/de75cdcda5368f0f08c4c8fd1d718ad542cf245a))
- reflects balance on network switch ([a0727ca](https://github.com/theQRL/qrl-web3-wallet/commit/a0727cad111b2b204df8c5c422260f668820bb2b))
