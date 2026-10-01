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
import { SIGNING_NONCE_BLOCK_TAG } from "@/constants/transactionNonce";
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

/**
 * Owned-token lookup result. `failed` separates "this account owns nothing
 * here" from "the chain could not be read", so the gallery can show an
 * error when the RPC is down and an empty collection only when the account
 * genuinely holds none.
 */
export type OwnedNftTokensResult = {
  tokens: OwnedNftToken[];
  failed: boolean;
};

/** What a probe did and what it found. */
export type ConnectionProbeResult = {
  /** False when the call was skipped: already probing, inside the manual
   *  cooldown, or no provider yet. `isConnected` is then the last known
   *  value, which nothing has just re-checked. */
  probed: boolean;
  isConnected: boolean;
};

export type InitPhaseType = "chain" | "network" | "accounts" | "session";

/** Startup phase reporting so the Home loader can show real progress. */
export type InitProgressType = {
  active: boolean;
  fraction: number;
  phase: InitPhaseType;
};

/** Balance re-poll cadence. Blocks land roughly once a minute, so 30s still
 *  shows incoming funds (plain receives and internal payouts alike) within a
 *  block of arrival while halving the RPC traffic of a side panel that stays
 *  open for hours. A send refreshes balances immediately on confirmation, so
 *  the user's own transfers never wait for a tick. */
export const BALANCE_POLL_INTERVAL_MS = 30000;

/** How many balance ticks pass between full connection probes while the node
 *  is answering. A failed tick, and every tick while the node is known down,
 *  probes regardless, so recovery is noticed within one interval. */
export const CONNECTION_REPROBE_TICKS = 4;

/** Ceiling on the backoff applied while the node is down and no surface is
 *  on screen. Nobody is reading the numbers, so a dead endpoint is left
 *  alone for minutes at a time. */
export const MAX_POLL_BACKOFF_MS = 300000;

/** Ceiling on the backoff while a surface is visible. A wallet the user is
 *  looking at should never be more than a minute behind reality, so the
 *  doubling stops here, short of the five-minute cap. */
export const VISIBLE_MAX_POLL_BACKOFF_MS = 60000;

/** Minimum gap between two manual probes. Tracked apart from the automatic
 *  backoff, so holding down Retry connection cannot keep the automatic
 *  schedule pinned at zero. */
export const MANUAL_PROBE_COOLDOWN_MS = 5000;

/** Ceiling on a single read issued by a poll tick, covering both the
 *  balance reads and the connection probe.
 *
 *  The vendored HTTP provider already bounds a request at 30 s for the
 *  header phase and 120 s overall (@theqrl/web3-providers-http), so this
 *  is not the difference between bounded and unbounded. It is the
 *  difference between 10 s and 30 s, and during that wait the in-flight
 *  guard holds every later tick and the Retry control stays disabled, so
 *  the shorter ceiling is what the UI needs. Matches the timeout the
 *  network assertion already uses. */
export const RPC_READ_TIMEOUT_MS = 10000;

/** Rejects when `work` outlives `timeoutMs`. The underlying request is not
 *  cancellable here, so it is abandoned in place; the caller
 *  treats the rejection as an unreachable node. */
const withTimeout = <T>(work: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("The node did not answer in time"));
    }, timeoutMs);
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
    });
  });

class QrlStore {
  qrlInstance?: Web3QRLInterface;
  qrlConnection = {
    isConnected: false,
    isLoading: false,
    /** True once a balance refresh has failed against a node that is no
     *  longer answering. The balances on screen are then the last known
     *  values, and the UI says so. */
    areBalancesStale: false,
    /** True while an out-of-schedule probe is running, whoever asked for
     *  it: the Retry control, the online event or a surface coming back to
     *  the front. Kept apart from isLoading, which the interval's own
     *  re-probes deliberately leave alone so the status dot does not pulse
     *  every few minutes. */
    isProbing: false,
    /** When the next manual probe is allowed. The store owns this
     *  deadline so that navigating away and back cannot hand someone a
     *  button that looks ready and then answers without probing. */
    nextManualProbeAt: 0,
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
  private ticksSinceConnectionProbe = 0;
  private isPollingAllowed = true;
  private consecutivePollFailures = 0;
  /** Timestamp before which poll ticks are skipped, set by the backoff. */
  private nextPollAllowedAt = 0;
  /** The poll currently running, if any. The interval used to be able to
   *  stack ticks, because the next-allowed timestamp is only written once
   *  the previous tick settles. */
  private pollInFlight: Promise<void> | null = null;
  /** Counts ticks as they start. A caller that joined an existing tick
   *  sees this unchanged, which is how it knows the answer it got may
   *  predate its own reason for asking. */
  private pollTickSequence = 0;

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
      pollBalancesAndConnection: action.bound,
      probeConnectionNow: action.bound,
      startBalancePolling: action.bound,
      stopBalancePolling: action.bound,
      setPollingAllowed: action.bound,
      getGasFeeData: action.bound,
      // Deliberately unannotated: see the reader itself for why it must
      // stay outside MobX's action wrapper.
      getAccountBalance: false,
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

  /**
   * Gates the balance poll on the wallet being unlocked.
   *
   * The loop is armed at the end of initialization, which can land after
   * the lock state is known, so the gate lives here and every caller
   * inherits it.
   */
  setPollingAllowed(allowed: boolean) {
    this.isPollingAllowed = allowed;
    if (!allowed) {
      this.stopBalancePolling();
      return;
    }
    if (!this.balancePollInterval && this.qrlInstance) {
      this.startBalancePolling();
    }
  }

  startBalancePolling() {
    this.stopBalancePolling();
    if (!this.isPollingAllowed) return;
    this.ticksSinceConnectionProbe = 0;
    this.consecutivePollFailures = 0;
    this.nextPollAllowedAt = 0;
    this.balancePollInterval = setInterval(() => {
      // A hidden side panel keeps its document alive; skip the tick
      // instead of polling for pixels nobody sees.
      if (typeof document !== "undefined" && document.hidden) return;
      // Backoff while the node is down: an unreachable endpoint gets
      // exponentially fewer calls, up to MAX_POLL_BACKOFF_MS apart.
      if (Date.now() < this.nextPollAllowedAt) return;
      void this.pollBalancesAndConnection();
    }, BALANCE_POLL_INTERVAL_MS);
  }

  /**
   * One poll tick: refresh balances, then decide whether the node itself
   * needs re-checking.
   *
   * The connection was probed once at startup and never again, so a node
   * that died mid-session left the status dot green and hour-old balances
   * looking current. A failed refresh probes immediately, a known-down node
   * probes every tick so recovery shows up fast, and an otherwise healthy
   * session probes every CONNECTION_REPROBE_TICKS ticks.
   *
   * A tick that finds the node down also pushes the next one further out,
   * doubling each time up to MAX_POLL_BACKOFF_MS. Recovery resets it.
   */
  async pollBalancesAndConnection() {
    // One tick at a time. A slow node, or one that swallows the request
    // until the read times out, used to let the interval start a second
    // tick on top of the first.
    if (this.pollInFlight) {
      await this.pollInFlight;
      return;
    }
    this.pollTickSequence += 1;
    const tick = this.runPollTick();
    this.pollInFlight = tick;
    try {
      await tick;
    } finally {
      runInAction(() => {
        this.pollInFlight = null;
      });
    }
  }

  private async runPollTick() {
    const refreshed = await this.refreshBalancesQuietly();
    this.ticksSinceConnectionProbe += 1;
    const shouldProbe =
      !refreshed ||
      !this.qrlConnection.isConnected ||
      this.ticksSinceConnectionProbe >= CONNECTION_REPROBE_TICKS;
    if (shouldProbe) {
      this.ticksSinceConnectionProbe = 0;
      await this.fetchQrlConnection({ quiet: true });
    }
    this.applyPollBackoff(refreshed && this.qrlConnection.isConnected);
  }

  /**
   * Probe the node right now, outside the automatic schedule.
   *
   * The backoff recovers on its own, but only on its own clock, so a node
   * that came back can go unnoticed for a while on a surface that stays
   * open. This is the single entry point for everything with reason to
   * believe the answer just changed: the browser regaining its connection,
   * a surface coming back to the front, and the Retry connection control.
   *
   * `probed` is false when the call was skipped, which the Retry control
   * needs so it never reports a verdict nothing went and checked.
   */
  async probeConnectionNow(options?: {
    manual?: boolean;
  }): Promise<ConnectionProbeResult> {
    const skipped = () => ({
      probed: false,
      isConnected: this.qrlConnection.isConnected,
    });
    if (!this.qrlInstance || !this.isPollingAllowed) return skipped();
    if (this.qrlConnection.isProbing) return skipped();
    if (options?.manual === true) {
      const now = Date.now();
      if (now < this.qrlConnection.nextManualProbeAt) return skipped();
      runInAction(() => {
        this.qrlConnection = {
          ...this.qrlConnection,
          nextManualProbeAt: now + MANUAL_PROBE_COOLDOWN_MS,
        };
      });
    }
    const sequenceBefore = this.pollTickSequence;
    this.resetPollSchedule();
    runInAction(() => {
      this.qrlConnection = { ...this.qrlConnection, isProbing: true };
    });
    try {
      await this.pollBalancesAndConnection();
      // A tick that was already running when this was asked for may have
      // issued its reads before whatever prompted the probe. Its answer is
      // therefore stale, and a stale failure would re-arm the backoff for
      // another minute. The sequence counter is unchanged exactly when
      // this call joined such a tick, so run one of our own.
      if (this.pollTickSequence === sequenceBefore) {
        this.resetPollSchedule();
        await this.pollBalancesAndConnection();
      }
    } finally {
      runInAction(() => {
        this.qrlConnection = { ...this.qrlConnection, isProbing: false };
      });
    }
    return { probed: true, isConnected: this.qrlConnection.isConnected };
  }

  /** Puts the automatic schedule back to its plain cadence and forces the
   *  next tick to probe the connection as well as the balances. */
  private resetPollSchedule() {
    runInAction(() => {
      this.consecutivePollFailures = 0;
      this.nextPollAllowedAt = 0;
      this.ticksSinceConnectionProbe = CONNECTION_REPROBE_TICKS;
    });
  }

  /**
   * Ceiling on the spacing between poll ticks.
   *
   * A surface the user is looking at should never be more than a minute
   * behind reality, so the doubling stops short while the document is
   * visible. A hidden document skips its ticks anyway, and a context with
   * no document at all keeps the long cap.
   */
  private maxPollBackoffMs() {
    if (typeof document === "undefined") return MAX_POLL_BACKOFF_MS;
    return document.hidden ? MAX_POLL_BACKOFF_MS : VISIBLE_MAX_POLL_BACKOFF_MS;
  }

  /** Spaces out ticks while the node is failing and restores the plain
   *  cadence the moment it answers again. */
  private applyPollBackoff(healthy: boolean) {
    if (healthy) {
      this.consecutivePollFailures = 0;
      this.nextPollAllowedAt = 0;
      return;
    }
    this.consecutivePollFailures += 1;
    const delay = Math.min(
      BALANCE_POLL_INTERVAL_MS * 2 ** this.consecutivePollFailures,
      this.maxPollBackoffMs(),
    );
    this.nextPollAllowedAt = Date.now() + delay;
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
   *  which zeroes them: acceptable at init, wrong mid-session) and the
   *  connection is marked down so the UI can flag them as stale.
   *
   *  Resolves true when the balances on screen are current. */
  async refreshBalancesQuietly(): Promise<boolean> {
    if (!this.qrlInstance || this.qrlAccounts.isLoading) return true;
    const requestId = ++this.balanceRequestId;
    const provider = this.qrlInstance;
    const chainId = this.qrlConnection.blockchain.chainId;
    const storedAccountsList = await StorageUtil.getAllAccounts();
    if (storedAccountsList.length === 0) return true;
    try {
      const accountsWithBalance: QrlAccountsType["accounts"] =
        await Promise.all(
          storedAccountsList.map(async (account) => {
            const accountBalance =
              (await withTimeout(
                Promise.resolve(provider.getBalance(account)),
                RPC_READ_TIMEOUT_MS,
              )) ?? BigInt(0);
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
        return true;
      runInAction(() => {
        this.qrlAccounts = {
          ...this.qrlAccounts,
          accounts: accountsWithBalance,
        };
        this.qrlConnection = { ...this.qrlConnection, areBalancesStale: false };
      });
      return true;
    } catch {
      // The node stopped answering: keep the last known balances on screen,
      // but stop presenting them as current.
      runInAction(() => {
        if (
          requestId !== this.balanceRequestId ||
          provider !== this.qrlInstance ||
          chainId !== this.qrlConnection.blockchain.chainId
        )
          return;
        this.qrlConnection = {
          ...this.qrlConnection,
          isConnected: false,
          areBalancesStale: true,
        };
      });
      return false;
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

  /**
   * Probes the configured node and records whether it is reachable.
   *
   * `quiet` skips the isLoading transition: a background re-probe must not
   * make the status dot pulse or disable the chain badge every few minutes.
   */
  async fetchQrlConnection(options?: { quiet?: boolean }) {
    const provider = this.qrlInstance;
    const blockchain = this.qrlConnection.blockchain;
    const quiet = options?.quiet === true;
    const isCurrent = () =>
      provider === this.qrlInstance &&
      blockchain === this.qrlConnection.blockchain;
    if (!quiet) {
      this.qrlConnection = { ...this.qrlConnection, isLoading: true };
    }
    try {
      await this.assertSigningNetwork();
      // Bounded like the balance reads. The network assertion ahead of it
      // normally fails fast on a dead route, but a route that accepts the
      // connection and then stalls used to leave this hanging on the
      // provider's own 30 s ceiling, holding isProbing true and the Retry
      // control disabled for the whole wait.
      const isListening =
        (await withTimeout(
          Promise.resolve(provider?.net.isListening()),
          RPC_READ_TIMEOUT_MS,
        )) ?? false;
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
        if (!isCurrent() || quiet) return;
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
        this.qrlConnection = { ...this.qrlConnection, areBalancesStale: false };
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

  /**
   * Last known balance of an account, as the display string the UI shows.
   *
   * A pure reader, and it has to stay one. Annotated as an action it ran
   * untracked, so an observer component reading it during render
   * registered no dependency on `qrlAccounts` and the row kept its first
   * painted number until something else it reads happened to change. Bound
   * as a class field because every call site destructures it off the
   * store, which a plain prototype method would not survive.
   */
  getAccountBalance = (accountAddress: string): string =>
    this.qrlAccounts.accounts.find(
      (account) => account.accountAddress === accountAddress,
    )?.accountBalance ?? "0.0 Quanta";

  /**
   * Worst-case fee for a native transfer, in Quanta.
   *
   * Priced off maxFeePerGas. For the three preset tiers that equals
   * baseFee + tip, and for an advanced override it is the ceiling the user
   * authorised, which is what the send form has to reserve and guard
   * against.
   */
  async getNativeTokenGas(overrides?: GasFeeOverrides) {
    const gasLimit =
      overrides?.tier === "advanced" && overrides.gasLimit
        ? overrides.gasLimit
        : NATIVE_TOKEN_UNITS_OF_GAS;
    const { maxFeePerGas } = await this.getGasFeeData(overrides);
    return utils.fromPlanck(BigInt(gasLimit) * maxFeePerGas, "quanta");
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
      const nonce = await this.qrlInstance?.getTransactionCount(
        from,
        SIGNING_NONCE_BLOCK_TAG,
      );
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
          token: {
            name,
            symbol,
            decimals,
            totalSupply,
            balance,
            // The exact on-chain integer. `balance` above is a float for
            // display; anything that has to compare or spend the balance
            // (the send form's guard and its Max) reads this one, so a
            // balance smaller than the display rounding still sends and Max
            // leaves no dust behind.
            balanceBaseUnits: balanceUnformatted.toString(),
            image: "",
          },
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
  ): Promise<OwnedNftTokensResult> {
    if (!this.qrlInstance || !this.qrlInstance.Contract) {
      return { tokens: [], failed: true };
    }
    const owner = this.activeAccount.accountAddress;
    if (!owner) return { tokens: [], failed: false };

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
      if (balance === 0) return { tokens: [], failed: false };

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
        return { tokens, failed: false };
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
      return { tokens, failed: false };
    } catch {
      return { tokens: [], failed: true };
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
  ): Promise<OwnedNftTokensResult> {
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
      return { tokens, failed: false };
    } catch {
      return { tokens: [], failed: true };
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
          this.qrlInstance?.getTransactionCount(from, SIGNING_NONCE_BLOCK_TAG),
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

  /** Worst-case fee for a ZRC-20 transfer, in Quanta. Priced the same way
   *  getNativeTokenGas is; see its comment. */
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
      const useAdvancedGasLimit =
        overrides?.tier === "advanced" && !!overrides.gasLimit;
      const transferCall = contract.methods.transfer(
        to,
        toTokenBaseUnits(value, decimals),
      );
      let gasLimit: number;
      if (useAdvancedGasLimit) {
        // An explicit advanced gas limit replaces the estimate, but the
        // transfer still has to be simulated: without it a transfer that
        // reverts on chain (frozen token, paused contract, blocked
        // recipient) was signed and broadcast, burning the whole limit in
        // fees. A revert here throws and the send form blocks on it.
        await transferCall.call({ from, gas: String(overrides.gasLimit!) });
        gasLimit = overrides.gasLimit!;
      } else {
        gasLimit = Number(await transferCall.estimateGas({ from }));
      }
      const { maxFeePerGas } = await this.getGasFeeData(overrides);
      return utils.fromPlanck(BigInt(gasLimit) * maxFeePerGas, "quanta");
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
        const nonce = await this.qrlInstance?.getTransactionCount(
          from,
          SIGNING_NONCE_BLOCK_TAG,
        );
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

  /**
   * Broadcasts a signed transaction and resolves with its receipt.
   *
   * `onBroadcast` fires as soon as the node has accepted the transaction and
   * returned its hash, well before the receipt exists. Callers that must
   * distinguish "the node took it" from "it was mined" (the replacement
   * flow, which only supersedes the original once the replacement is live)
   * use it; the promise alone cannot tell the two apart.
   */
  async sendRawTransaction(
    rawTransaction: string,
    onBroadcast?: (transactionHash: string) => void,
  ) {
    await this.assertSigningNetwork();
    const pending = this.qrlInstance?.sendSignedTransaction(rawTransaction);
    if (onBroadcast && pending && typeof pending.on === "function") {
      pending.on("transactionHash", (transactionHash) => {
        onBroadcast(String(transactionHash));
      });
    }
    const receipt = await pending;
    return receipt;
  }
}

export default QrlStore;
