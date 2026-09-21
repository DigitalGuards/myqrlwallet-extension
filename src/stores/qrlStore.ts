import {
  BlockchainDataType,
  DEFAULT_BLOCKCHAIN,
} from "@/configuration/qrlBlockchainConfig";
import { NATIVE_TOKEN_UNITS_OF_GAS } from "@/constants/nativeToken";
import {
  ZRC_721_CONTRACT_ABI,
  ZRC_1155_CONTRACT_ABI,
  ERC_721_INTERFACE_ID,
  ERC_721_ENUMERABLE_INTERFACE_ID,
  ERC_1155_INTERFACE_ID,
  NFT_UNITS_OF_GAS,
} from "@/constants/nftToken";
import { discoverOwnedNftTokens } from "@/services/assetDiscovery";
import type { NFTStandard, OwnedNftToken } from "@/types/nft";
import { substituteErc1155TokenId } from "@/utilities/ipfsUtil";
import {
  ZRC_20_CONTRACT_ABI,
  ZRC_20_TOKEN_UNITS_OF_GAS,
} from "@/constants/zrc20Token";
import { getHexSeedFromMnemonic } from "@/functions/getHexSeedFromMnemonic";
import { getOptimalTokenBalance } from "@/functions/getOptimalTokenBalance";
import { toTokenBaseUnits } from "@/functions/tokenAmount";
import type { GasFeeOverrides } from "@/types/gasFee";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import { toCanonicalQrlAddress } from "@/utilities/addressUtil";
import StorageUtil from "@/utilities/storageUtil";
import { assertV3Network, V3_CHAIN_ID } from "@/configuration/releaseProfile";
import Web3, { Web3QRLInterface, utils } from "@theqrl/web3";
import { action, makeAutoObservable, observable, runInAction } from "mobx";

type ActiveAccountType = {
  accountAddress: string;
};

type QrlAccountType = {
  accountAddress: string;
  accountBalance: string;
};

type QrlAccountsType = {
  accounts: QrlAccountType[];
  isLoading: boolean;
};

export type InitPhaseType = "chain" | "network" | "accounts" | "session";

/** Startup phase reporting so the Home loader can show real progress. */
export type InitProgressType = {
  active: boolean;
  fraction: number;
  phase: InitPhaseType;
};

/** Balance re-poll cadence. Blocks land roughly once a minute, so 15s keeps
 *  incoming funds (plain receives and internal payouts alike) visible within
 *  a block of arrival without meaningful RPC load. */
export const BALANCE_POLL_INTERVAL_MS = 15000;

class QrlStore {
  qrlInstance?: Web3QRLInterface;
  qrlConnection = {
    isConnected: false,
    isLoading: false,
    blockchain: DEFAULT_BLOCKCHAIN,
  };
  qrlAccounts: QrlAccountsType = { accounts: [], isLoading: false };
  activeAccount: ActiveAccountType = { accountAddress: "" };
  initProgress: InitProgressType = {
    active: true,
    fraction: 0,
    phase: "chain",
  };
  private balancePollInterval: ReturnType<typeof setInterval> | null = null;
  private balanceRequestId = 0;
  private initializationEpoch = 0;

  constructor() {
    makeAutoObservable(this, {
      initializeBlockchain: action.bound,
      setInitProgress: action.bound,
      qrlInstance: observable.struct,
      initProgress: observable.struct,
      qrlConnection: observable.struct,
      qrlAccounts: observable.struct,
      activeAccount: observable.struct,
      refreshBlockchainData: action.bound,
      selectBlockchain: action.bound,
      setActiveAccount: action.bound,
      clearAccountState: action.bound,
      assertAccountRemovable: action.bound,
      removeAccount: action.bound,
      fetchQrlConnection: action.bound,
      fetchAccounts: action.bound,
      refreshBalancesQuietly: action.bound,
      startBalancePolling: action.bound,
      stopBalancePolling: action.bound,
      getGasFeeData: action.bound,
      getAccountBalance: action.bound,
      getNativeTokenGas: action.bound,
      signNativeToken: action.bound,
      getZrc20TokenDetails: action.bound,
      getZrc20TokenGas: action.bound,
      signZrc20Token: action.bound,
      signAndSendReplacementTransaction: action.bound,
      getTransactionReceipt: action.bound,
      sendRawTransaction: action.bound,
      getNftCollectionDetails: action.bound,
      getOwnedNftTokens: action.bound,
      getErc1155TokenBalance: action.bound,
      getNftTokenUri: action.bound,
      signNftTransfer: action.bound,
    });
    this.initializeBlockchain();
  }

  async initializeBlockchain() {
    const epoch = ++this.initializationEpoch;
    this.stopBalancePolling();
    this.balanceRequestId++;
    this.setInitProgress({ active: true, fraction: 0.06, phase: "chain" });
    await this.refreshBlockchainData();
    if (epoch !== this.initializationEpoch) return;
    const qrlHttpProvider = new Web3.providers.HttpProvider(
      this.qrlConnection.blockchain.defaultRpcUrl || "http://localhost",
    );
    const { qrl } = new Web3({ provider: qrlHttpProvider });
    this.qrlInstance = qrl;

    this.setInitProgress({ active: true, fraction: 0.18, phase: "network" });
    await this.fetchQrlConnection();
    if (epoch !== this.initializationEpoch) return;
    this.setInitProgress({ active: true, fraction: 0.45, phase: "accounts" });
    await this.fetchAccounts();
    if (epoch !== this.initializationEpoch) return;
    this.setInitProgress({ active: true, fraction: 0.94, phase: "session" });
    await this.validateActiveAccount(epoch);
    if (epoch !== this.initializationEpoch) return;
    this.setInitProgress({ active: false, fraction: 1, phase: "session" });
    // Balances only refreshed on init and after sends before this; funds
    // arriving while the popup/side panel stays open (plain receives,
    // internal payouts) never showed up. The interval dies with the
    // document, so a closed popup costs nothing.
    this.startBalancePolling();
  }

  startBalancePolling() {
    this.stopBalancePolling();
    this.balancePollInterval = setInterval(() => {
      // A hidden side panel keeps its document alive; skip the tick
      // instead of polling for pixels nobody sees.
      if (typeof document !== "undefined" && document.hidden) return;
      void this.refreshBalancesQuietly();
    }, BALANCE_POLL_INTERVAL_MS);
  }

  stopBalancePolling() {
    if (this.balancePollInterval) {
      clearInterval(this.balancePollInterval);
      this.balancePollInterval = null;
    }
  }

  /** Re-fetch every account balance without touching isLoading or init
   *  progress, so a background poll never flashes loading states. On RPC
   *  failure the last known balances stay on screen (unlike fetchAccounts,
   *  which zeroes them: acceptable at init, wrong mid-session). */
  async refreshBalancesQuietly() {
    if (!this.qrlInstance || this.qrlAccounts.isLoading) return;
    const requestId = ++this.balanceRequestId;
    const provider = this.qrlInstance;
    const chainId = this.qrlConnection.blockchain.chainId;
    const storedAccountsList = await StorageUtil.getAllAccounts();
    if (storedAccountsList.length === 0) return;
    try {
      const accountsWithBalance: QrlAccountsType["accounts"] =
        await Promise.all(
          storedAccountsList.map(async (account) => {
            const accountBalance =
              (await provider.getBalance(account)) ?? BigInt(0);
            return {
              accountAddress: account,
              accountBalance: getOptimalTokenBalance(
                utils.fromPlanck(accountBalance, "quanta"),
              ),
            };
          }),
        );
      if (
        requestId !== this.balanceRequestId ||
        provider !== this.qrlInstance ||
        chainId !== this.qrlConnection.blockchain.chainId
      )
        return;
      runInAction(() => {
        this.qrlAccounts = {
          ...this.qrlAccounts,
          accounts: accountsWithBalance,
        };
      });
    } catch {
      // Transient RPC failure: keep showing the last known balances.
    }
  }

  setInitProgress(progress: InitProgressType) {
    this.initProgress = progress;
  }

  async addChain(chainData: BlockchainDataType) {
    const newChain: BlockchainDataType = {
      ...chainData,
      chainId: chainData?.chainId?.trim(),
      chainName: chainData?.chainName?.trim()?.substring(0, 100),
    };
    const blockchains = await StorageUtil.getAllBlockChains();
    const chainFound = !!blockchains.find(
      (chain) => chain.chainId.toLowerCase() === newChain.chainId.toLowerCase(),
    );
    return { chainFound, updatedChainList: [...blockchains, newChain] };
  }

  async editChain(chainData: BlockchainDataType) {
    const editedChain = {
      ...chainData,
      chainId: chainData?.chainId?.trim(),
      chainName: chainData?.chainName?.trim()?.substring(0, 100),
    };
    const blockchains = await StorageUtil.getAllBlockChains();
    const updatedChainList: BlockchainDataType[] = blockchains.map((chain) =>
      chain.chainId.toLowerCase() === editedChain?.chainId?.toLowerCase()
        ? { ...chain, ...editedChain }
        : chain,
    );
    return { updatedChainList };
  }

  async refreshBlockchainData() {
    const blockchain = await StorageUtil.getActiveBlockChain();
    this.qrlConnection = { ...this.qrlConnection, blockchain };
  }

  async selectBlockchain(chainId: string) {
    await StorageUtil.setActiveBlockChain(chainId);
    await this.initializeBlockchain();
  }

  async setActiveAccount(activeAccount?: string) {
    const canonicalActiveAccount = activeAccount
      ? toCanonicalQrlAddress(activeAccount)
      : undefined;
    await StorageUtil.setActiveAccount(canonicalActiveAccount);
    this.activeAccount = {
      ...this.activeAccount,
      accountAddress: canonicalActiveAccount ?? "",
    };

    let storedAccountList: string[] = [];
    try {
      const accountListFromStorage = await StorageUtil.getAllAccounts();
      storedAccountList = [...accountListFromStorage];
      if (canonicalActiveAccount) {
        storedAccountList.push(canonicalActiveAccount);
      }
      storedAccountList = [...new Set(storedAccountList)];
    } finally {
      await StorageUtil.setAllAccounts(storedAccountList);
      await this.fetchAccounts();
    }
  }

  /**
   * Remove one account from the wallet: its encrypted keystore, its
   * accounts-list entry, and its cached transaction history. Funds stay on
   * chain; getting the account back requires re-importing its seed or a
   * backup. If the removed account was active, the first remaining account
   * becomes active.
   */
  /**
   * Throws REMOVE_LAST_KEYSTORE_BLOCKED when removing this account would
   * leave the wallet with zero keystores but accounts still listed (only
   * reachable with Ledger accounts, which live in the accounts list without
   * a keystore).
   *
   * The service worker derives "this wallet has been set up" from keystores
   * AND accounts both being non-empty, so that state drops the wallet to a
   * first-run screen: onboarding, with no password gate, while it still
   * holds usable accounts.
   *
   * Callable on its own so the UI can bail out before any destructive step
   * (notably before the decrypted key is scrubbed).
   */
  async assertAccountRemovable(accountAddress: string) {
    const target = accountAddress.toLowerCase();
    const [keystores, storedAccounts] = await Promise.all([
      StorageUtil.getKeystores(),
      StorageUtil.getAllAccounts(),
    ]);
    const remainingKeystores = keystores.filter(
      (keystore) => keystore.address.toLowerCase() !== target,
    );
    const remainingAccounts = storedAccounts.filter(
      (account) => account.toLowerCase() !== target,
    );
    if (remainingKeystores.length === 0 && remainingAccounts.length > 0) {
      throw new Error("REMOVE_LAST_KEYSTORE_BLOCKED");
    }
    return { remainingKeystores, remainingAccounts };
  }

  async removeAccount(accountAddress: string) {
    const target = accountAddress.toLowerCase();
    const { remainingKeystores, remainingAccounts } =
      await this.assertAccountRemovable(accountAddress);

    // Order matters: everything before setKeystores is recoverable, the
    // keystore delete is not. Dropping the accounts-list entry first means
    // an interrupted removal (the popup is destroyed the moment it loses
    // focus) leaves an orphaned keystore, not a listed account whose seed
    // is gone.
    await StorageUtil.setAllAccounts(remainingAccounts);
    await StorageUtil.removeAccountFromAllDApps(accountAddress);
    await StorageUtil.clearAllAccountData(accountAddress);
    await StorageUtil.setKeystores(remainingKeystores);

    const storedActiveAccount = await StorageUtil.getActiveAccount();
    if (storedActiveAccount?.toLowerCase() === target) {
      await this.setActiveAccount(remainingAccounts[0]);
    } else {
      await this.fetchAccounts();
    }
  }

  /**
   * Forget the accounts held in memory, without touching storage.
   *
   * The stores are per-document singletons, so a wallet reset performed in
   * another surface (or before this one reloads) leaves this document still
   * holding the destroyed wallet: onboarding would then render its address
   * and offer to continue with it. Onboarding only ever runs when no wallet
   * exists, so clearing there is always correct.
   */
  clearAccountState() {
    this.activeAccount = { accountAddress: "" };
    this.qrlAccounts = { ...this.qrlAccounts, accounts: [], isLoading: false };
  }

  async fetchQrlConnection() {
    const provider = this.qrlInstance;
    const blockchain = this.qrlConnection.blockchain;
    const isCurrent = () =>
      provider === this.qrlInstance &&
      blockchain === this.qrlConnection.blockchain;
    this.qrlConnection = { ...this.qrlConnection, isLoading: true };
    try {
      await this.assertSigningNetwork();
      const isListening = (await provider?.net.isListening()) ?? false;
      runInAction(() => {
        if (!isCurrent()) return;
        this.qrlConnection = {
          ...this.qrlConnection,
          isConnected: isListening,
        };
      });
    } catch {
      runInAction(() => {
        if (!isCurrent()) return;
        this.qrlConnection = { ...this.qrlConnection, isConnected: false };
      });
    } finally {
      runInAction(() => {
        if (!isCurrent()) return;
        this.qrlConnection = { ...this.qrlConnection, isLoading: false };
      });
    }
  }

  async fetchAccounts() {
    const requestId = ++this.balanceRequestId;
    const provider = this.qrlInstance;
    const chainId = this.qrlConnection.blockchain.chainId;
    const isCurrent = () =>
      requestId === this.balanceRequestId &&
      provider === this.qrlInstance &&
      chainId === this.qrlConnection.blockchain.chainId;
    this.qrlAccounts = { ...this.qrlAccounts, isLoading: true };

    let storedAccountsList: string[] = [];
    const accountListFromStorage = await StorageUtil.getAllAccounts();
    storedAccountsList = accountListFromStorage;
    let settledBalances = 0;
    try {
      const accountsWithBalance: QrlAccountsType["accounts"] =
        await Promise.all(
          storedAccountsList.map(async (account) => {
            const accountBalance =
              (await provider?.getBalance(account)) ?? BigInt(0);
            const convertedAccountBalance = getOptimalTokenBalance(
              utils.fromPlanck(accountBalance, "quanta"),
            );
            settledBalances += 1;
            // Real per-account progress across the balances phase (0.45-0.94).
            if (
              isCurrent() &&
              this.initProgress.active &&
              this.initProgress.phase === "accounts"
            ) {
              this.setInitProgress({
                active: true,
                fraction:
                  0.45 + 0.49 * (settledBalances / storedAccountsList.length),
                phase: "accounts",
              });
            }
            return {
              accountAddress: account,
              accountBalance: convertedAccountBalance,
            };
          }),
        );
      if (!isCurrent()) return;
      runInAction(() => {
        this.qrlAccounts = {
          ...this.qrlAccounts,
          accounts: accountsWithBalance,
        };
      });
    } catch {
      if (!isCurrent()) return;
      runInAction(() => {
        this.qrlAccounts = {
          ...this.qrlAccounts,
          accounts: storedAccountsList.map((account) => ({
            accountAddress: account,
            accountBalance: "0.0 Quanta",
          })),
        };
      });
    } finally {
      runInAction(() => {
        if (isCurrent())
          this.qrlAccounts = { ...this.qrlAccounts, isLoading: false };
      });
    }
  }

  async validateActiveAccount(epoch = this.initializationEpoch) {
    const storedActiveAccount = await StorageUtil.getActiveAccount();
    if (epoch !== this.initializationEpoch) return;

    const confirmedExistingActiveAccount =
      this.qrlAccounts.accounts.find(
        (account) => account.accountAddress === storedActiveAccount,
      )?.accountAddress ?? "";
    if (!confirmedExistingActiveAccount) {
      await StorageUtil.clearActiveAccount();
    }
    runInAction(() => {
      this.activeAccount = {
        ...this.activeAccount,
        accountAddress: confirmedExistingActiveAccount,
      };
    });
  }

  private async getBaseTip(): Promise<bigint> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tip = await (this.qrlInstance as any)?.requestManager?.send({
        method: "qrl_maxPriorityFeePerGas",
        params: [],
      });
      const parsed = BigInt(tip);
      if (parsed > BigInt(0)) return parsed;
    } catch {
      // RPC method not supported - fall back to default
    }
    return BigInt(utils.toPlanck("2", "shor"));
  }

  async getGasFeeData(overrides?: GasFeeOverrides) {
    const latestBlock = await this.qrlInstance?.getBlock("latest");
    const baseFeePerGas = latestBlock?.baseFeePerGas ?? BigInt(0);

    if (overrides?.tier === "advanced") {
      const maxPriorityFeePerGas = overrides.maxPriorityFeePerGas ?? BigInt(0);
      const maxFeePerGas =
        overrides.maxFeePerGas ?? baseFeePerGas + maxPriorityFeePerGas;
      return { baseFeePerGas, maxPriorityFeePerGas, maxFeePerGas };
    }

    const baseTip = await this.getBaseTip();
    let maxPriorityFeePerGas: bigint;

    switch (overrides?.tier) {
      case "low":
        maxPriorityFeePerGas = baseTip;
        break;
      case "aggressive":
        maxPriorityFeePerGas = baseTip * BigInt(2);
        break;
      case "market":
      default:
        // 1.5x - multiply by 3 then divide by 2, rounded up
        maxPriorityFeePerGas = (baseTip * BigInt(3) + BigInt(1)) / BigInt(2);
        break;
    }

    const maxFeePerGas = baseFeePerGas + maxPriorityFeePerGas;
    return { baseFeePerGas, maxPriorityFeePerGas, maxFeePerGas };
  }

  getAccountBalance(accountAddress: string) {
    return (
      this.qrlAccounts.accounts.find(
        (account) => account.accountAddress === accountAddress,
      )?.accountBalance ?? "0.0 Quanta"
    );
  }

  async getNativeTokenGas(overrides?: GasFeeOverrides) {
    const gasLimit =
      overrides?.tier === "advanced" && overrides.gasLimit
        ? overrides.gasLimit
        : NATIVE_TOKEN_UNITS_OF_GAS;
    const { baseFeePerGas, maxPriorityFeePerGas } =
      await this.getGasFeeData(overrides);
    return utils.fromPlanck(
      BigInt(gasLimit) * (baseFeePerGas + maxPriorityFeePerGas),
      "quanta",
    );
  }

  async signNativeToken(
    from: string,
    to: string,
    value: string | number,
    mnemonicPhrases: string,
    overrides?: GasFeeOverrides,
  ) {
    let result: {
      transactionHash?: string;
      rawTransaction?: string;
      error: string;
      nonce?: number;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      gasLimit?: number;
    } = { error: "" };

    try {
      const { maxFeePerGas, maxPriorityFeePerGas } =
        await this.getGasFeeData(overrides);
      const gasLimit =
        overrides?.tier === "advanced" && overrides.gasLimit
          ? overrides.gasLimit
          : NATIVE_TOKEN_UNITS_OF_GAS;
      const nonce = await this.qrlInstance?.getTransactionCount(from);
      const transactionObject = {
        from,
        to,
        value: toTokenBaseUnits(value, 18).toString(),
        nonce,
        gasLimit,
        maxFeePerGas: `0x${maxFeePerGas.toString(16)}`,
        maxPriorityFeePerGas: `0x${maxPriorityFeePerGas.toString(16)}`,
        type: 2,
        chainId: V3_CHAIN_ID,
      };
      await this.assertSigningNetwork();
      const signedTransaction =
        await this.qrlInstance?.accounts.signTransaction(
          transactionObject,
          getHexSeedFromMnemonic(mnemonicPhrases),
        );
      if (signedTransaction) {
        result = {
          transactionHash: signedTransaction.transactionHash?.toString(),
          rawTransaction: signedTransaction.rawTransaction?.toString(),
          error: "",
          nonce: Number(nonce),
          maxFeePerGas: maxFeePerGas.toString(),
          maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
          gasLimit,
        };
      } else {
        throw new Error("Transaction could not be signed");
      }
    } catch (error) {
      result = {
        ...result,
        error: `Transaction could not be signed. ${error}`,
      };
    }

    return result;
  }

  async getZrc20TokenDetails(contractAddress: string) {
    const tokenDetails = {
      token: undefined,
      error: "",
    };

    const contractAbi = ZRC_20_CONTRACT_ABI;

    if (this.qrlInstance && this.qrlInstance.Contract) {
      try {
        const contract = new this.qrlInstance.Contract(
          contractAbi,
          contractAddress,
        );
        const name = (await contract.methods.name().call()) as string;
        const symbol = (await contract.methods.symbol().call()) as string;
        const decimals = (await contract.methods.decimals().call()) as bigint;
        const totalSupplyUnformatted = (await contract.methods
          .totalSupply()
          .call()) as bigint;
        const totalSupply =
          Number(totalSupplyUnformatted) / Math.pow(10, Number(decimals));
        const balanceUnformatted = (await contract.methods
          .balanceOf(this.activeAccount.accountAddress)
          .call()) as bigint;
        const balance =
          Number(balanceUnformatted) / Math.pow(10, Number(decimals));
        return {
          ...tokenDetails,
          token: { name, symbol, decimals, totalSupply, balance, image: "" },
        };
      } catch {
        return {
          ...tokenDetails,
          error:
            "Could not retreive the token with the entered contract address",
        };
      }
    }

    return tokenDetails;
  }

  async getNftCollectionDetails(contractAddress: string) {
    const result: {
      collection?: {
        name: string;
        symbol: string;
        // Owned-token count. Undefined for ZRC-1155: the standard has no
        // per-owner enumeration, so the count comes from the explorer at
        // the UI layer instead of the chain.
        balance?: number;
        standard: NFTStandard;
      };
      error: string;
    } = { error: "" };

    if (this.qrlInstance && this.qrlInstance.Contract) {
      try {
        const contract = new this.qrlInstance.Contract(
          ZRC_721_CONTRACT_ABI,
          contractAddress,
        );

        const isErc721 = (await contract.methods
          .supportsInterface(ERC_721_INTERFACE_ID)
          .call()) as boolean;

        if (isErc721) {
          const name = (await contract.methods.name().call()) as string;
          const symbol = (await contract.methods.symbol().call()) as string;
          const balance = Number(
            (await contract.methods
              .balanceOf(this.activeAccount.accountAddress)
              .call()) as bigint,
          );
          return {
            ...result,
            collection: { name, symbol, balance, standard: "ZRC721" as const },
          };
        }

        // Not ERC-721: probe for ERC-1155. name()/symbol() are not part
        // of the 1155 standard, so both are best-effort.
        const isErc1155 = (await contract.methods
          .supportsInterface(ERC_1155_INTERFACE_ID)
          .call()) as boolean;

        if (isErc1155) {
          let name = "";
          let symbol = "";
          try {
            name = (await contract.methods.name().call()) as string;
          } catch {
            // Optional in ERC-1155.
          }
          try {
            symbol = (await contract.methods.symbol().call()) as string;
          } catch {
            // Optional in ERC-1155.
          }
          return {
            ...result,
            collection: { name, symbol, standard: "ZRC1155" as const },
          };
        }

        return {
          ...result,
          error: "Contract does not support ZRC-721 or ZRC-1155",
        };
      } catch {
        return {
          ...result,
          error:
            "Could not retrieve the NFT collection with the entered contract address",
        };
      }
    }

    return result;
  }

  /**
   * Lists the tokens the active account owns inside one collection.
   *
   * ZRC-721: on-chain enumeration (tokenOfOwnerByIndex) when the contract
   * implements the Enumerable extension; otherwise falls back to explorer
   * discovery with every candidate re-verified via ownerOf, so a stale
   * explorer index can't show a transferred-out token.
   *
   * ZRC-1155: the standard has no owner enumeration, so candidates always
   * come from the explorer and are re-verified via balanceOf(account, id);
   * the live per-id balance is returned alongside each token.
   */
  async getOwnedNftTokens(
    contractAddress: string,
    standard: NFTStandard = "ZRC721",
  ): Promise<OwnedNftToken[]> {
    if (!this.qrlInstance || !this.qrlInstance.Contract) return [];
    const owner = this.activeAccount.accountAddress;
    if (!owner) return [];

    if (standard === "ZRC1155") {
      return this.getOwned1155Tokens(contractAddress, owner);
    }

    try {
      const contract = new this.qrlInstance.Contract(
        ZRC_721_CONTRACT_ABI,
        contractAddress,
      );

      const balance = Number(
        (await contract.methods.balanceOf(owner).call()) as bigint,
      );
      if (balance === 0) return [];

      let isEnumerable = false;
      try {
        isEnumerable = (await contract.methods
          .supportsInterface(ERC_721_ENUMERABLE_INTERFACE_ID)
          .call()) as boolean;
      } catch {
        isEnumerable = false;
      }

      if (isEnumerable) {
        const tokens: OwnedNftToken[] = [];
        for (let i = 0; i < balance; i++) {
          const tokenId = (await contract.methods
            .tokenOfOwnerByIndex(owner, i)
            .call()) as bigint;
          tokens.push({ tokenId: tokenId.toString() });
        }
        return tokens;
      }

      // Non-enumerable: ask the explorer which ids this account holds,
      // then confirm each against the chain.
      const discovered = await discoverOwnedNftTokens(
        owner,
        this.qrlConnection.blockchain.chainId,
        contractAddress,
      );
      const tokens: OwnedNftToken[] = [];
      for (const candidate of discovered) {
        try {
          const currentOwner = (await contract.methods
            .ownerOf(BigInt(candidate.tokenId))
            .call()) as string;
          if (currentOwner.toLowerCase() === owner.toLowerCase()) {
            tokens.push({ tokenId: candidate.tokenId });
          }
        } catch {
          // Reverted ownerOf (burned id / stale index row): skip.
        }
      }
      return tokens;
    } catch {
      return [];
    }
  }

  /**
   * Live balanceOf(activeAccount, tokenId) for one ERC-1155 id, as a
   * decimal string. Undefined on any failure so callers can keep their
   * previous value instead of treating an RPC blip as a zero balance.
   */
  async getErc1155TokenBalance(
    contractAddress: string,
    tokenId: string,
  ): Promise<string | undefined> {
    if (!this.qrlInstance || !this.qrlInstance.Contract) return undefined;
    const owner = this.activeAccount.accountAddress;
    if (!owner) return undefined;
    try {
      const contract = new this.qrlInstance.Contract(
        ZRC_1155_CONTRACT_ABI,
        contractAddress,
      );
      const balance = (await contract.methods
        .balanceOf(owner, BigInt(tokenId))
        .call()) as bigint;
      return balance.toString();
    } catch {
      return undefined;
    }
  }

  private async getOwned1155Tokens(
    contractAddress: string,
    owner: string,
  ): Promise<OwnedNftToken[]> {
    try {
      const contract = new this.qrlInstance!.Contract(
        ZRC_1155_CONTRACT_ABI,
        contractAddress,
      );
      const discovered = await discoverOwnedNftTokens(
        owner,
        this.qrlConnection.blockchain.chainId,
        contractAddress,
      );
      const tokens: OwnedNftToken[] = [];
      for (const candidate of discovered) {
        try {
          const balance = (await contract.methods
            .balanceOf(owner, BigInt(candidate.tokenId))
            .call()) as bigint;
          if (balance > 0n) {
            tokens.push({
              tokenId: candidate.tokenId,
              balance: balance.toString(),
            });
          }
        } catch {
          // Skip ids the contract rejects.
        }
      }
      return tokens;
    } catch {
      return [];
    }
  }

  async getNftTokenUri(
    contractAddress: string,
    tokenId: string,
    standard: NFTStandard = "ZRC721",
  ) {
    if (this.qrlInstance && this.qrlInstance.Contract) {
      try {
        if (standard === "ZRC1155") {
          const contract = new this.qrlInstance.Contract(
            ZRC_1155_CONTRACT_ABI,
            contractAddress,
          );
          const uri = (await contract.methods
            .uri(BigInt(tokenId))
            .call()) as string;
          return substituteErc1155TokenId(uri, tokenId);
        }
        const contract = new this.qrlInstance.Contract(
          ZRC_721_CONTRACT_ABI,
          contractAddress,
        );
        const uri = (await contract.methods.tokenURI(tokenId).call()) as string;
        return uri;
      } catch {
        return "";
      }
    }
    return "";
  }

  async signNftTransfer(
    from: string,
    to: string,
    tokenId: string,
    mnemonicPhrases: string,
    contractAddress: string,
    standard: NFTStandard = "ZRC721",
    // ERC-1155 only: how many copies of `tokenId` to send.
    amount = "1",
    overrides?: GasFeeOverrides,
  ) {
    let result: {
      transactionHash?: string;
      rawTransaction?: string;
      error: string;
      nonce?: number;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      gasLimit?: number;
      data?: string;
    } = { error: "" };

    if (this.qrlInstance && this.qrlInstance.Contract) {
      try {
        const transferCall =
          standard === "ZRC1155"
            ? new this.qrlInstance.Contract(
                ZRC_1155_CONTRACT_ABI,
                contractAddress,
              ).methods.safeTransferFrom(
                from,
                to,
                BigInt(tokenId),
                BigInt(amount),
                "0x",
              )
            : new this.qrlInstance.Contract(
                ZRC_721_CONTRACT_ABI,
                contractAddress,
              ).methods.safeTransferFrom(from, to, BigInt(tokenId));
        // Run all RPC calls in parallel for speed
        const useAdvancedGas =
          overrides?.tier === "advanced" && overrides.gasLimit;
        const [gasFeeData, estimatedGasResult, nonce] = await Promise.all([
          this.getGasFeeData(overrides),
          useAdvancedGas
            ? Promise.resolve(null)
            : transferCall.estimateGas({ from }).catch(() => null),
          this.qrlInstance?.getTransactionCount(from),
        ]);
        const { maxFeePerGas, maxPriorityFeePerGas } = gasFeeData;
        let gasLimit = useAdvancedGas ? overrides!.gasLimit! : NFT_UNITS_OF_GAS;
        if (estimatedGasResult !== null && estimatedGasResult !== undefined) {
          // Add 20% buffer to estimated gas
          gasLimit = Math.ceil(Number(estimatedGasResult) * 1.2);
        }
        const encodedData = transferCall.encodeABI();
        const transactionObject = {
          from,
          to: contractAddress,
          data: encodedData,
          nonce,
          gasLimit,
          maxFeePerGas: `0x${maxFeePerGas.toString(16)}`,
          maxPriorityFeePerGas: `0x${maxPriorityFeePerGas.toString(16)}`,
          type: 2,
          chainId: V3_CHAIN_ID,
        };

        await this.assertSigningNetwork();

        const signedTransaction =
          await this.qrlInstance?.accounts.signTransaction(
            transactionObject,
            getHexSeedFromMnemonic(mnemonicPhrases),
          );

        if (signedTransaction) {
          result = {
            transactionHash: signedTransaction.transactionHash?.toString(),
            rawTransaction: signedTransaction.rawTransaction?.toString(),
            error: "",
            nonce: Number(nonce),
            maxFeePerGas: maxFeePerGas.toString(),
            maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
            gasLimit,
            data: encodedData,
          };
        } else {
          throw new Error("Transaction could not be signed");
        }
      } catch (error) {
        console.error("[signNftTransfer] Error:", error);
        result = {
          ...result,
          error: `Transaction could not be signed. ${error}`,
        };
      }
    } else {
      console.error("[signNftTransfer] qrlInstance not available");
      result = { ...result, error: "Blockchain connection not available" };
    }

    return result;
  }

  async getZrc20TokenGas(
    from: string,
    to: string,
    value: string | number,
    contractAddress: string,
    decimals: number,
    overrides?: GasFeeOverrides,
  ) {
    if (this.qrlInstance && this.qrlInstance.Contract) {
      const contract = new this.qrlInstance.Contract(
        ZRC_20_CONTRACT_ABI,
        contractAddress,
      );
      const contractTransfer = contract.methods.transfer(
        to,
        toTokenBaseUnits(value, decimals),
      );
      const estimatedGasLimit = Number(
        await contractTransfer.estimateGas({ from }),
      );
      const gasLimit =
        overrides?.tier === "advanced" && overrides.gasLimit
          ? overrides.gasLimit
          : estimatedGasLimit;
      const { baseFeePerGas, maxPriorityFeePerGas } =
        await this.getGasFeeData(overrides);
      return utils.fromPlanck(
        BigInt(gasLimit) * (baseFeePerGas + maxPriorityFeePerGas),
        "quanta",
      );
    }
    return "";
  }

  async signZrc20Token(
    from: string,
    to: string,
    value: string | number,
    mnemonicPhrases: string,
    contractAddress: string,
    decimals: number,
    overrides?: GasFeeOverrides,
  ) {
    let result: {
      transactionHash?: string;
      rawTransaction?: string;
      error: string;
      nonce?: number;
      maxFeePerGas?: string;
      maxPriorityFeePerGas?: string;
      gasLimit?: number;
      data?: string;
    } = { error: "" };

    const contractAbi = ZRC_20_CONTRACT_ABI;

    if (this.qrlInstance && this.qrlInstance.Contract) {
      try {
        const contract = new this.qrlInstance.Contract(
          contractAbi,
          contractAddress,
        );
        const contractTransfer = contract.methods.transfer(
          to,
          toTokenBaseUnits(value, decimals),
        );
        const { maxFeePerGas, maxPriorityFeePerGas } =
          await this.getGasFeeData(overrides);
        const gasLimit =
          overrides?.tier === "advanced" && overrides.gasLimit
            ? overrides.gasLimit
            : ZRC_20_TOKEN_UNITS_OF_GAS;
        const nonce = await this.qrlInstance?.getTransactionCount(from);
        const encodedData = contractTransfer.encodeABI();
        const transactionObject = {
          from,
          to: contractAddress,
          data: encodedData,
          nonce,
          gasLimit,
          maxFeePerGas: `0x${maxFeePerGas.toString(16)}`,
          maxPriorityFeePerGas: `0x${maxPriorityFeePerGas.toString(16)}`,
          type: 2,
          chainId: V3_CHAIN_ID,
        };

        await this.assertSigningNetwork();

        const signedTransaction =
          await this.qrlInstance?.accounts.signTransaction(
            transactionObject,
            getHexSeedFromMnemonic(mnemonicPhrases),
          );

        if (signedTransaction) {
          result = {
            transactionHash: signedTransaction.transactionHash?.toString(),
            rawTransaction: signedTransaction.rawTransaction?.toString(),
            error: "",
            nonce: Number(nonce),
            maxFeePerGas: maxFeePerGas.toString(),
            maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
            gasLimit,
            data: encodedData,
          };
        } else {
          throw new Error("Transaction could not be signed");
        }
      } catch (error) {
        result = {
          ...result,
          error: `Transaction could not be signed. ${error}`,
        };
      }
    }

    return result;
  }
  async signAndSendReplacementTransaction(
    originalTx: TransactionHistoryEntry,
    replacementAction: "speed-up" | "cancel",
    mnemonicPhrases: string,
    overrides?: GasFeeOverrides,
  ) {
    let result: {
      transactionHash?: string;
      rawTransaction?: string;
      error: string;
    } = { error: "" };

    try {
      const tier = overrides?.tier ?? "aggressive";
      const { maxFeePerGas: newMaxFee, maxPriorityFeePerGas: newPriorityFee } =
        await this.getGasFeeData({ ...overrides, tier });

      // Enforce ≥10% bump over original
      const origMaxFee = BigInt(originalTx.maxFeePerGas ?? "0");
      const origPriorityFee = BigInt(originalTx.maxPriorityFeePerGas ?? "0");
      const minBumpedMaxFee =
        origMaxFee + (origMaxFee * BigInt(10)) / BigInt(100);
      const minBumpedPriorityFee =
        origPriorityFee + (origPriorityFee * BigInt(10)) / BigInt(100);

      const finalMaxFee =
        newMaxFee > minBumpedMaxFee ? newMaxFee : minBumpedMaxFee;
      const finalPriorityFee =
        newPriorityFee > minBumpedPriorityFee
          ? newPriorityFee
          : minBumpedPriorityFee;

      const nonce = originalTx.nonce;
      if (nonce === undefined) {
        throw new Error("Original transaction nonce is not available");
      }

      let transactionObject;
      if (replacementAction === "cancel") {
        transactionObject = {
          from: originalTx.from,
          to: originalTx.from,
          value: "0",
          nonce,
          gasLimit: NATIVE_TOKEN_UNITS_OF_GAS,
          maxFeePerGas: `0x${finalMaxFee.toString(16)}`,
          maxPriorityFeePerGas: `0x${finalPriorityFee.toString(16)}`,
          type: 2,
          chainId: V3_CHAIN_ID,
        };
      } else {
        // Any token/NFT entry carries a contract address; the real
        // transaction goes TO the contract with the transfer calldata, not to
        // the human recipient. Keying only off isZrc20Token sent NFT
        // replacements to the recipient EOA with the calldata as inert bytes,
        // consuming the nonce and destroying the transfer while it reported
        // success. Route every contract interaction to its contract, with
        // value 0, and preserve the original calldata.
        const isContractInteraction = !!originalTx.tokenContractAddress;
        transactionObject = {
          from: originalTx.from,
          to: isContractInteraction
            ? originalTx.tokenContractAddress
            : originalTx.to,
          value: isContractInteraction
            ? "0"
            : utils.toPlanck(originalTx.amount, "quanta"),
          nonce,
          gasLimit:
            originalTx.gasLimit ??
            (isContractInteraction
              ? ZRC_20_TOKEN_UNITS_OF_GAS
              : NATIVE_TOKEN_UNITS_OF_GAS),
          maxFeePerGas: `0x${finalMaxFee.toString(16)}`,
          maxPriorityFeePerGas: `0x${finalPriorityFee.toString(16)}`,
          type: 2,
          chainId: V3_CHAIN_ID,
          ...(originalTx.data && { data: originalTx.data }),
        };
      }

      await this.assertSigningNetwork();

      const signedTransaction =
        await this.qrlInstance?.accounts.signTransaction(
          transactionObject,
          getHexSeedFromMnemonic(mnemonicPhrases),
        );

      if (!signedTransaction) {
        throw new Error("Replacement transaction could not be signed");
      }

      result = {
        transactionHash: signedTransaction.transactionHash?.toString(),
        rawTransaction: signedTransaction.rawTransaction?.toString(),
        error: "",
      };
    } catch (error) {
      result = { error: `Replacement transaction failed. ${error}` };
    }

    return result;
  }

  async getTransactionReceipt(txHash: string) {
    return await this.qrlInstance?.getTransactionReceipt(txHash);
  }

  private async assertSigningNetwork() {
    const provider = this.qrlInstance;
    const chain = this.qrlConnection.blockchain;
    if (chain.chainId.toLowerCase() !== V3_CHAIN_ID) {
      throw new Error("Select the v3 Private network.");
    }
    await assertV3Network(chain.defaultRpcUrl);
    if (
      provider !== this.qrlInstance ||
      chain !== this.qrlConnection.blockchain
    ) {
      throw new Error("The network changed. Review the request again.");
    }
  }

  async sendRawTransaction(rawTransaction: string) {
    await this.assertSigningNetwork();
    const receipt =
      await this.qrlInstance?.sendSignedTransaction(rawTransaction);
    return receipt;
  }
}

export default QrlStore;
