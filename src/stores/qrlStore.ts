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
import type { GasFeeOverrides } from "@/types/gasFee";
import type { TransactionHistoryEntry } from "@/types/transactionHistory";
import StorageUtil from "@/utilities/storageUtil";
import Web3, {
  Web3QRLInterface,
  utils,
} from "@theqrl/web3";
import { BigNumber } from "bignumber.js";
import { action, makeAutoObservable, observable, runInAction } from "mobx";

/**
 * Convert a human token amount (a JS number from the form) to integer base
 * units without float error. `value * 10 ** decimals` overflows float
 * precision for high-decimal tokens (signing a corrupted amount) and yields
 * non-integers like 110.00000000000001 that `BigInt()` rejects with a
 * RangeError (blocking everyday sends). BigNumber shifts the decimal point on
 * the string representation, then floors so we can never send more than the
 * displayed amount.
 */
const toTokenBaseUnits = (value: number, decimals: number): bigint =>
  BigInt(
    // Stringify first: bignumber.js 4.1.0 throws on a number literal with more
    // than 15 significant digits, which a high-precision amount can exceed.
    new BigNumber(String(value))
      .times(new BigNumber(10).pow(decimals))
      .toFixed(0, BigNumber.ROUND_DOWN),
  );

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

class QrlStore {
  qrlInstance?: Web3QRLInterface;
  qrlConnection = {
    isConnected: false,
    isLoading: false,
    blockchain: DEFAULT_BLOCKCHAIN,
  };
  qrlAccounts: QrlAccountsType = { accounts: [], isLoading: false };
  activeAccount: ActiveAccountType = { accountAddress: "" };
  initProgress: InitProgressType = { active: true, fraction: 0, phase: "chain" };

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
      fetchQrlConnection: action.bound,
      fetchAccounts: action.bound,
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
      getNftTokenUri: action.bound,
      signNftTransfer: action.bound,
    });
    this.initializeBlockchain();
  }

  async initializeBlockchain() {
    this.setInitProgress({ active: true, fraction: 0.06, phase: "chain" });
    await this.refreshBlockchainData();
    const qrlHttpProvider = new Web3.providers.HttpProvider(
      this.qrlConnection.blockchain.defaultRpcUrl || "http://localhost",
    );
    const { qrl } = new Web3({ provider: qrlHttpProvider });
    this.qrlInstance = qrl;

    this.setInitProgress({ active: true, fraction: 0.18, phase: "network" });
    await this.fetchQrlConnection();
    this.setInitProgress({ active: true, fraction: 0.45, phase: "accounts" });
    await this.fetchAccounts();
    this.setInitProgress({ active: true, fraction: 0.94, phase: "session" });
    await this.validateActiveAccount();
    this.setInitProgress({ active: false, fraction: 1, phase: "session" });
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
    await StorageUtil.setActiveAccount(activeAccount);
    this.activeAccount = {
      ...this.activeAccount,
      accountAddress: activeAccount ?? "",
    };

    let storedAccountList: string[] = [];
    try {
      const accountListFromStorage = await StorageUtil.getAllAccounts();
      storedAccountList = [...accountListFromStorage];
      if (activeAccount) {
        storedAccountList.push(activeAccount);
      }
      storedAccountList = [...new Set(storedAccountList)];
    } finally {
      await StorageUtil.setAllAccounts(storedAccountList);
      await this.fetchAccounts();
    }
  }

  async fetchQrlConnection() {
    this.qrlConnection = { ...this.qrlConnection, isLoading: true };
    try {
      const isListening = (await this.qrlInstance?.net.isListening()) ?? false;
      runInAction(() => {
        this.qrlConnection = {
          ...this.qrlConnection,
          isConnected: isListening,
        };
      });
    } catch {
      runInAction(() => {
        this.qrlConnection = { ...this.qrlConnection, isConnected: false };
      });
    } finally {
      runInAction(() => {
        this.qrlConnection = { ...this.qrlConnection, isLoading: false };
      });
    }
  }

  async fetchAccounts() {
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
              (await this.qrlInstance?.getBalance(account)) ?? BigInt(0);
            const convertedAccountBalance = getOptimalTokenBalance(
              utils.fromPlanck(accountBalance, "quanta"),
            );
            settledBalances += 1;
            // Real per-account progress across the balances phase (0.45-0.94).
            if (this.initProgress.active && this.initProgress.phase === "accounts") {
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
      runInAction(() => {
        this.qrlAccounts = {
          ...this.qrlAccounts,
          accounts: accountsWithBalance,
        };
      });
    } catch {
      runInAction(() => {
        this.qrlAccounts = {
          ...this.qrlAccounts,
          accounts: storedAccountsList.map((account) => ({
            accountAddress: account,
            accountBalance: "0.0 QRL",
          })),
        };
      });
    } finally {
      runInAction(() => {
        this.qrlAccounts = { ...this.qrlAccounts, isLoading: false };
      });
    }
  }

  async validateActiveAccount() {
    this.activeAccount = { accountAddress: "" };
    const storedActiveAccount = await StorageUtil.getActiveAccount();

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
      // RPC method not supported — fall back to default
    }
    return BigInt(utils.toPlanck("2", "shor"));
  }

  async getGasFeeData(overrides?: GasFeeOverrides) {
    const latestBlock = await this.qrlInstance?.getBlock("latest");
    const baseFeePerGas = latestBlock?.baseFeePerGas ?? BigInt(0);

    if (overrides?.tier === "advanced") {
      const maxPriorityFeePerGas =
        overrides.maxPriorityFeePerGas ?? BigInt(0);
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
        // 1.5x — multiply by 3 then divide by 2, rounded up
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
      )?.accountBalance ?? "0.0 QRL"
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
    value: number,
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
        value: utils.toPlanck(value, "quanta"),
        nonce,
        gasLimit,
        maxFeePerGas: `0x${maxFeePerGas.toString(16)}`,
        maxPriorityFeePerGas: `0x${maxPriorityFeePerGas.toString(16)}`,
        type: 2,
      };
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
        const uri = (await contract.methods
          .tokenURI(tokenId)
          .call()) as string;
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
            : transferCall
                .estimateGas({ from })
                .catch(() => null),
          this.qrlInstance?.getTransactionCount(from),
        ]);
        const { maxFeePerGas, maxPriorityFeePerGas } = gasFeeData;
        let gasLimit = useAdvancedGas
          ? overrides!.gasLimit!
          : NFT_UNITS_OF_GAS;
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
        };

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
    value: number,
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
    value: number,
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
        };

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
          ...(originalTx.data && { data: originalTx.data }),
        };
      }

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

  async sendRawTransaction(rawTransaction: string) {
    const receipt =
      await this.qrlInstance?.sendSignedTransaction(rawTransaction);
    return receipt;
  }
}

export default QrlStore;
