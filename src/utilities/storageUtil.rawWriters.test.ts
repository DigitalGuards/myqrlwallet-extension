import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyStore } from "@theqrl/web3";
import browser from "webextension-polyfill";
import {
  DEFAULT_BLOCKCHAIN,
  QRL_BLOCKCHAINS,
} from "@/configuration/qrlBlockchainConfig";
import StorageUtil, { LockState } from "./storageUtil";
import { getStoredValue, isRecord, isWalletSettings } from "./storageGuards";
import { malformed } from "@/test-utils/malformed";
import {
  storageMutationValues,
  type StorageJunkValue,
} from "./__mocks__/storageGeneratedCases";
import {
  ACCOUNT,
  OTHER_ACCOUNT,
  CHAIN,
  TOKEN,
  NFT,
  HISTORY,
  CONNECTION,
  LEDGER,
} from "./__mocks__/storageFixtures";
import {
  checkAccountAndChainHaveBeenAuthorized,
  includeChainForUrlOrigin,
  excludeChainForUrlOrigin,
  updatePermissionsForUrlOrigin,
} from "@/scripts/utils/restrictedMethodsMiddlewareUtils";
import { restrictedMethodsMiddleware } from "@/scripts/middlewares/restrictedMethodsMiddleware";
import { EXTENSION_MESSAGES } from "@/scripts/constants/streamConstants";
import { openApprovalSurface } from "@/scripts/utils/approvalSurface";
import { resetApprovalSlot } from "@/scripts/utils/approvalSlot";

const h = vi.hoisted(() => {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const copy = (value: unknown): unknown =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const area = (store: Record<string, unknown>) => ({
    get: (key: string) => Promise.resolve({ [key]: copy(store[key]) }),
    set: (data: Record<string, unknown>) => {
      Object.assign(store, copy(data));
      return Promise.resolve();
    },
    remove: (key: string) => {
      Reflect.deleteProperty(store, key);
      return Promise.resolve();
    },
    clear: () => {
      for (const key of Object.keys(store)) Reflect.deleteProperty(store, key);
      return Promise.resolve();
    },
  });
  return {
    local,
    session,
    copy,
    localArea: area(local),
    sessionArea: area(session),
  };
});
vi.mock("@/utilities/profileStorage", () => ({
  walletLocalStorage: h.localArea,
  walletSessionStorage: h.sessionArea,
}));
vi.mock("@/scripts/lockManager/lockManager", () => ({
  default: {
    isLocked: () => Promise.resolve({ isLocked: false, hasPasswordSet: true }),
  },
}));
vi.mock("@/scripts/phishing/phishingDetector", () => ({
  checkDomain: () => ({ isDomainPhishing: false }),
}));
vi.mock("@/scripts/utils/approvalSurface", () => ({
  openApprovalSurface: vi.fn(),
}));
vi.mock("@/scripts/utils/dAppTransactionWatcher", () => ({
  registerDAppTransactionWatch: vi.fn(),
}));

const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error("Expected a fixture object");
  return value;
};
const at = (root: unknown, path: string[]) =>
  record(getStoredValue(root, ...path));
const set = (root: unknown, path: string[], value: unknown) => {
  const key = path.at(-1);
  if (key === undefined) throw new Error("Expected a fixture path");
  Object.defineProperty(at(root, path.slice(0, -1)), key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
};
const remove = (root: unknown, path: string[]) => {
  const key = path.at(-1);
  if (key === undefined) throw new Error("Expected a fixture path");
  Reflect.deleteProperty(at(root, path.slice(0, -1)), key);
};
const origin = CONNECTION.urlOrigin;
const draftKey = `${CHAIN.chainId}_TRANSACTION_VALUES`;
const tokenPath = ["TOKENS", "ALL_TOKENS", ACCOUNT, CHAIN.chainId, "tokens"];
const nftPath = [
  "NFT_COLLECTIONS",
  "ALL_NFT_COLLECTIONS",
  ACCOUNT,
  CHAIN.chainId,
  "collections",
];
const historyPath = [
  "TX_HISTORY",
  "ALL_TX_HISTORY",
  ACCOUNT,
  CHAIN.chainId,
  "transactions",
];
const grantPath = ["DAPPS", "ALL_DAPPS", origin];
const clearStore = (store: Record<string, unknown>) => {
  for (const key of Object.keys(store)) Reflect.deleteProperty(store, key);
};
const seed = (local: unknown, session: unknown) => {
  clearStore(h.local);
  clearStore(h.session);
  Object.assign(h.local, h.copy(local));
  Object.assign(h.session, h.copy(session));
};

// Independent fixtures and expected field edits form the oracle. Every writer
// runs against each interleaving, including opaque fields at every ancestor.
const fixture = (
  junk: StorageJunkValue,
  position: number,
  mixedMetadata = false,
) => {
  const weave = (values: unknown[]) => [
    ...values.slice(0, position),
    junk,
    ...values.slice(position),
  ];
  const chain = {
    ...CHAIN,
    chainName: mixedMetadata ? junk : CHAIN.chainName,
    future: junk,
    nativeCurrency: { ...CHAIN.nativeCurrency, future: junk },
  };
  const otherChain = {
    ...(mixedMetadata ? chain : CHAIN),
    chainId: "0x43",
    future: junk,
  };
  const token = {
    ...TOKEN,
    decimals: mixedMetadata ? junk : TOKEN.decimals,
    future: junk,
  };
  const otherToken = { ...token, address: "token-b" };
  const nft = {
    ...NFT,
    standard: mixedMetadata ? junk : NFT.standard,
    future: junk,
  };
  const otherNFT = { ...nft, address: "nft-b" };
  const history = {
    ...HISTORY,
    timestamp: mixedMetadata ? junk : HISTORY.timestamp,
    future: junk,
  };
  const otherHistory = { ...history, transactionHash: "hash-b" };
  const ledger = {
    ...LEDGER,
    publicKey: mixedMetadata ? junk : LEDGER.publicKey,
    future: junk,
  };
  const otherLedger = { ...ledger, address: OTHER_ACCOUNT };
  const contact = {
    address: ACCOUNT,
    name: mixedMetadata ? junk : "First",
    future: junk,
  };
  const otherContact = {
    address: OTHER_ACCOUNT,
    name: mixedMetadata ? junk : "Second",
    future: junk,
  };
  const keystore = {
    address: ACCOUNT,
    crypto: {},
    ...(mixedMetadata ? { version: junk } : {}),
    future: junk,
  };
  const otherKeystore = { address: OTHER_ACCOUNT, crypto: {}, future: junk };
  const lists = {
    chains: weave([chain, otherChain]),
    tokens: weave([token, otherToken]),
    nfts: weave([nft, otherNFT]),
    history: weave([history, otherHistory]),
    ledger: weave([ledger, otherLedger]),
    contacts: weave([contact, otherContact]),
    accounts: weave([ACCOUNT, OTHER_ACCOUNT]),
    keystores: weave([keystore, otherKeystore]),
  };
  const permissions = weave([
    {
      invoker: origin,
      parentCapability: "qrl_accounts",
      future: junk,
      caveats: weave([
        { type: "future", value: junk },
        {
          type: "restrictReturnedAccounts",
          value: lists.accounts,
          future: junk,
        },
      ]),
    },
    {
      invoker: origin,
      parentCapability: "qrl_chains",
      caveats: weave([
        {
          type: "restrictNetworkSwitching",
          value: weave([CHAIN.chainId]),
          future: junk,
        },
      ]),
      future: junk,
    },
  ]);
  const grant = {
    ...CONNECTION,
    accounts: lists.accounts,
    blockchains: lists.chains,
    permissions,
    future: junk,
  };
  const details = {
    isZrc20Token: true,
    tokenContractAddress: TOKEN.address,
    tokenDecimals: 18,
    tokenImage: false,
    tokenBalance: "10",
    tokenName: "Token",
    tokenSymbol: "TOK",
    future: junk,
  };
  const draft = {
    receiverAddress: OTHER_ACCOUNT,
    amount: "1.5",
    tokenDetails: details,
    future: junk,
  };
  const request = {
    method: "qrl_accounts",
    requestId: "r1",
    ...(mixedMetadata ? { params: junk } : {}),
    future: junk,
  };
  const nested = (all: string, field: string, items: unknown[]) => ({
    future: junk,
    [all]: {
      future: junk,
      [OTHER_ACCOUNT]: { future: junk },
      [ACCOUNT]: {
        future: junk,
        otherChain: { future: junk },
        [CHAIN.chainId]: { future: junk, [field]: items },
      },
    },
  });
  const local = {
    future: junk,
    KEYSTORES: JSON.stringify(lists.keystores),
    LOCK_MANAGER_LOCKED_TIMESTAMP: 1,
    LOCK_MANAGER_UNLOCKED_TIMESTAMP: 2,
    ACCOUNTS: {
      ALL_ACCOUNTS: lists.accounts,
      ACTIVE_ACCOUNT: ACCOUNT,
      future: junk,
    },
    BLOCKCHAINS: {
      ALL_BLOCKCHAINS: lists.chains,
      ACTIVE_BLOCKCHAIN: CHAIN.chainId,
      future: junk,
    },
    CONTACTS: { ALL_CONTACTS: lists.contacts, future: junk },
    LEDGER: { LEDGER_ACCOUNTS: lists.ledger, future: junk },
    TOKENS: nested("ALL_TOKENS", "tokens", lists.tokens),
    NFT_COLLECTIONS: nested("ALL_NFT_COLLECTIONS", "collections", lists.nfts),
    TX_HISTORY: nested("ALL_TX_HISTORY", "transactions", lists.history),
    DAPPS: {
      ALL_DAPPS: { [origin]: grant, unrelated: { future: junk }, opaque: junk },
      future: junk,
    },
    ACCOUNT_LABELS: {
      [`Q${"d".repeat(40)}`]: "Legacy",
      [ACCOUNT]: "First",
      [OTHER_ACCOUNT]: "Second",
      opaque: junk,
    },
    HIDDEN_ACCOUNTS: {
      [`Q${"d".repeat(40)}`]: true,
      [ACCOUNT]: true,
      [OTHER_ACCOUNT]: false,
      opaque: junk,
    },
    SETTINGS: {
      themePreference: "dark",
      currency: "EUR",
      ...(mixedMetadata
        ? {
            autoLockMinutes: 1,
            notificationsEnabled: false,
            sidePanelSurface: junk,
          }
        : {}),
      future: junk,
    },
    PRICE_CACHE: { prices: { usd: 1, opaque: junk }, future: junk },
    ACTIVE_PAGE: "/home",
    [draftKey]: draft,
  };
  const session = {
    DAPPS: { DAPPS_REQUEST_DATA: request, future: junk },
    future: junk,
  };
  return {
    local,
    session,
    lists,
    chain,
    otherChain,
    token,
    nft,
    history,
    ledger,
    contact,
    keystore,
    otherKeystore,
    details,
    draft,
    request,
    grant,
    permissions,
    junk,
  };
};
type Fixture = ReturnType<typeof fixture>;
type Expected = {
  local: Record<string, unknown>;
  session: Record<string, unknown>;
};
type WriterCase = {
  run: (f: Fixture) => Promise<unknown>;
  edit: (expected: Expected, f: Fixture) => void;
};
const editCaveatValues = (
  expected: Expected,
  type: string,
  edit: (values: unknown[]) => unknown[],
) => {
  for (const permission of list(
    getStoredValue(expected.local, ...grantPath, "permissions"),
  )) {
    for (const caveat of list(getStoredValue(permission, "caveats"))) {
      if (isRecord(caveat) && caveat.type === type)
        caveat.value = edit(list(caveat.value));
    }
  }
};
type WriterName = Extract<
  keyof typeof StorageUtil,
  | `set${string}`
  | `clear${string}`
  | `add${string}`
  | `remove${string}`
  | `update${string}`
>;
const cases = {
  setKeystores: {
    run: () =>
      StorageUtil.setKeystores([
        malformed<KeyStore>({ address: ACCOUNT, crypto: {} }),
      ]),
    edit: (e, f) => {
      e.local.KEYSTORES = JSON.stringify(
        f.lists.keystores.filter((v) => v !== f.otherKeystore),
      );
    },
  },
  clearKeystores: {
    run: () => StorageUtil.clearKeystores(),
    edit: (e) => {
      remove(e.local, ["KEYSTORES"]);
    },
  },
  updateLockStateTimeStamp: {
    run: () => StorageUtil.updateLockStateTimeStamp(LockState.LOCKED),
    edit: (e) => {
      e.local.LOCK_MANAGER_LOCKED_TIMESTAMP = 123;
    },
  },
  setTransactionValues: {
    run: () =>
      StorageUtil.setTransactionValues({
        receiverAddress: ACCOUNT,
        amount: "2",
      }),
    edit: (e, f) => {
      set(e.local, [draftKey], {
        ...f.draft,
        receiverAddress: ACCOUNT,
        amount: "2",
        tokenDetails: undefined,
      });
    },
  },
  clearTransactionValues: {
    run: () => StorageUtil.clearTransactionValues(),
    edit: (e) => {
      remove(e.local, [draftKey]);
    },
  },
  setAllAccounts: {
    run: () => StorageUtil.setAllAccounts([OTHER_ACCOUNT]),
    edit: (e, f) => {
      set(
        e.local,
        ["ACCOUNTS", "ALL_ACCOUNTS"],
        f.lists.accounts.filter((v) => v !== ACCOUNT),
      );
    },
  },
  setActiveAccount: {
    run: () => StorageUtil.setActiveAccount(OTHER_ACCOUNT),
    edit: (e) => {
      set(e.local, ["ACCOUNTS", "ACTIVE_ACCOUNT"], OTHER_ACCOUNT);
    },
  },
  clearActiveAccount: {
    run: () => StorageUtil.clearActiveAccount(),
    edit: (e) => {
      remove(e.local, ["ACCOUNTS", "ACTIVE_ACCOUNT"]);
    },
  },
  setAllBlockChains: {
    run: () =>
      StorageUtil.setAllBlockChains([
        { ...CHAIN, chainName: "Edited" },
        { ...CHAIN, chainId: "0x43" },
      ]),
    edit: (e, f) => {
      set(
        e.local,
        ["BLOCKCHAINS", "ALL_BLOCKCHAINS"],
        f.lists.chains.map((v) =>
          v === f.chain
            ? { ...record(h.copy(f.chain)), chainName: "Edited" }
            : v,
        ),
      );
    },
  },
  setActiveBlockChain: {
    run: () => StorageUtil.setActiveBlockChain("0x43"),
    edit: (e) => {
      set(e.local, ["BLOCKCHAINS", "ACTIVE_BLOCKCHAIN"], "0x43");
    },
  },
  setActivePage: {
    run: () => StorageUtil.setActivePage("/send"),
    edit: (e) => {
      e.local.ACTIVE_PAGE = "/send";
    },
  },
  clearActivePage: {
    run: () => StorageUtil.clearActivePage(),
    edit: (e) => {
      remove(e.local, ["ACTIVE_PAGE"]);
    },
  },
  setTokenContractsList: {
    run: () =>
      StorageUtil.setTokenContractsList(ACCOUNT, { ...TOKEN, symbol: "EDIT" }),
    edit: (e, f) => {
      set(e.local, tokenPath, [
        ...f.lists.tokens.filter((v) => v !== f.token),
        { ...f.token, symbol: "EDIT" },
      ]);
    },
  },
  clearFromTokenContractsList: {
    run: () => StorageUtil.clearFromTokenContractsList(ACCOUNT, TOKEN.address),
    edit: (e, f) => {
      set(
        e.local,
        tokenPath,
        f.lists.tokens.filter((v) => v !== f.token),
      );
    },
  },
  setNFTCollectionsList: {
    run: () =>
      StorageUtil.setNFTCollectionsList(ACCOUNT, { ...NFT, name: "Edited" }),
    edit: (e, f) => {
      set(e.local, nftPath, [
        ...f.lists.nfts.filter((v) => v !== f.nft),
        { ...f.nft, name: "Edited" },
      ]);
    },
  },
  clearFromNFTCollectionsList: {
    run: () => StorageUtil.clearFromNFTCollectionsList(ACCOUNT, NFT.address),
    edit: (e, f) => {
      set(
        e.local,
        nftPath,
        f.lists.nfts.filter((v) => v !== f.nft),
      );
    },
  },
  setDAppsRequestData: {
    run: () =>
      StorageUtil.setDAppsRequestData({
        method: "qrl_accounts",
        requestId: "r2",
      }),
    edit: (e, f) => {
      set(e.session, ["DAPPS", "DAPPS_REQUEST_DATA"], {
        ...f.request,
        requestId: "r2",
      });
    },
  },
  clearDAppsRequestDataForRequestId: {
    run: () => StorageUtil.clearDAppsRequestDataForRequestId("r1"),
    edit: (e) => {
      remove(e.session, ["DAPPS", "DAPPS_REQUEST_DATA"]);
    },
  },
  clearDAppsRequestData: {
    run: () => StorageUtil.clearDAppsRequestData(),
    edit: (e) => {
      remove(e.session, ["DAPPS", "DAPPS_REQUEST_DATA"]);
    },
  },
  setDAppsConnectedAccountsData: {
    run: () =>
      StorageUtil.setDAppsConnectedAccountsData({
        ...CONNECTION,
        blockchains: [CHAIN, { ...CHAIN, chainId: "0x43" }],
      }),
    edit: (e) => {
      // Nonempty strings are stored chain identities whose membership is
      // explicitly replaced by this approval. Opaque values retain their slot.
      editCaveatValues(e, "restrictNetworkSwitching", (values) =>
        values.filter(
          (value) =>
            typeof value !== "string" ||
            value.trim() === "" ||
            value === CHAIN.chainId,
        ),
      );
    },
  },
  addDAppChain: {
    run: () => StorageUtil.addDAppChain(origin, { ...CHAIN, chainId: "0x44" }),
    edit: (e, f) => {
      set(
        e.local,
        [...grantPath, "blockchains"],
        [...f.lists.chains, { ...CHAIN, chainId: "0x44" }],
      );
      editCaveatValues(e, "restrictNetworkSwitching", (values) => [
        ...values,
        "0x44",
      ]);
    },
  },
  removeDAppChain: {
    run: () => StorageUtil.removeDAppChain(origin, CHAIN.chainId),
    edit: (e, f) => {
      set(
        e.local,
        [...grantPath, "blockchains"],
        f.lists.chains.filter((v) => v !== f.chain),
      );
      editCaveatValues(e, "restrictNetworkSwitching", (values) =>
        values.filter((value) => value !== CHAIN.chainId),
      );
    },
  },
  clearDAppsConnectedAccountsData: {
    run: () => StorageUtil.clearDAppsConnectedAccountsData(origin),
    edit: (e) => {
      remove(e.local, grantPath);
    },
  },
  clearAllAccountData: {
    run: () => StorageUtil.clearAllAccountData(ACCOUNT),
    edit: (e) => {
      for (const [root, all] of [
        ["TOKENS", "ALL_TOKENS"],
        ["NFT_COLLECTIONS", "ALL_NFT_COLLECTIONS"],
        ["TX_HISTORY", "ALL_TX_HISTORY"],
      ])
        remove(e.local, [root, all, ACCOUNT]);
    },
  },
  removeAccountFromAllDApps: {
    run: () => StorageUtil.removeAccountFromAllDApps(ACCOUNT),
    edit: (e, f) => {
      const accounts = f.lists.accounts.filter((v) => v !== ACCOUNT);
      set(e.local, [...grantPath, "accounts"], accounts);
      editCaveatValues(e, "restrictReturnedAccounts", (values) =>
        values.filter((value) => value !== ACCOUNT),
      );
    },
  },
  setContacts: {
    run: () =>
      StorageUtil.setContacts([
        { address: ACCOUNT, name: "Edited" },
        { address: OTHER_ACCOUNT, name: "Second" },
      ]),
    edit: (e, f) => {
      set(
        e.local,
        ["CONTACTS", "ALL_CONTACTS"],
        f.lists.contacts.map((v) =>
          v === f.contact ? { ...f.contact, name: "Edited" } : v,
        ),
      );
    },
  },
  clearContacts: {
    run: () => StorageUtil.clearContacts(),
    edit: (e) => {
      remove(e.local, ["CONTACTS"]);
    },
  },
  setAccountLabels: {
    run: () => StorageUtil.setAccountLabels({ [ACCOUNT]: "Edited" }),
    edit: (e, f) => {
      set(e.local, ["ACCOUNT_LABELS"], {
        [ACCOUNT]: "Edited",
        opaque: f.junk,
      });
    },
  },
  setAccountLabel: {
    run: () => StorageUtil.setAccountLabel(ACCOUNT, "Edited"),
    edit: (e) => {
      set(e.local, ["ACCOUNT_LABELS", ACCOUNT], "Edited");
    },
  },
  clearAccountLabels: {
    run: () => StorageUtil.clearAccountLabels(),
    edit: (e) => {
      remove(e.local, ["ACCOUNT_LABELS"]);
    },
  },
  setHiddenAccounts: {
    run: () => StorageUtil.setHiddenAccounts({ [ACCOUNT]: false }),
    edit: (e, f) => {
      set(e.local, ["HIDDEN_ACCOUNTS"], {
        [ACCOUNT]: false,
        opaque: f.junk,
      });
    },
  },
  clearHiddenAccounts: {
    run: () => StorageUtil.clearHiddenAccounts(),
    edit: (e) => {
      remove(e.local, ["HIDDEN_ACCOUNTS"]);
    },
  },
  setSettings: {
    run: () =>
      StorageUtil.setSettings({ themePreference: "dark", currency: "USD" }),
    edit: (e) => {
      set(e.local, ["SETTINGS", "currency"], "USD");
    },
  },
  clearAllData: {
    run: () => StorageUtil.clearAllData(),
    edit: (e) => {
      e.local = {};
    },
  },
  setLedgerAccounts: {
    run: () =>
      StorageUtil.setLedgerAccounts([
        { ...LEDGER, index: 7 },
        { ...LEDGER, address: OTHER_ACCOUNT },
      ]),
    edit: (e, f) => {
      set(
        e.local,
        ["LEDGER", "LEDGER_ACCOUNTS"],
        f.lists.ledger.map((v) =>
          v === f.ledger ? { ...f.ledger, index: 7 } : v,
        ),
      );
    },
  },
  clearLedgerAccounts: {
    run: () => StorageUtil.clearLedgerAccounts(),
    edit: (e) => {
      remove(e.local, ["LEDGER", "LEDGER_ACCOUNTS"]);
    },
  },
  addLedgerAccountToAllAccounts: {
    run: () => StorageUtil.addLedgerAccountToAllAccounts(`Q${"c".repeat(128)}`),
    edit: (e, f) => {
      set(
        e.local,
        ["ACCOUNTS", "ALL_ACCOUNTS"],
        [...f.lists.accounts, addedAccount],
      );
    },
  },
  removeLedgerAccountFromAllAccounts: {
    run: () => StorageUtil.removeLedgerAccountFromAllAccounts(ACCOUNT),
    edit: (e, f) => {
      set(
        e.local,
        ["ACCOUNTS", "ALL_ACCOUNTS"],
        f.lists.accounts.filter((v) => v !== ACCOUNT),
      );
    },
  },
  setTransactionHistoryEntry: {
    run: () =>
      StorageUtil.setTransactionHistoryEntry(ACCOUNT, {
        ...HISTORY,
        amount: "2",
      }),
    edit: (e, f) => {
      set(e.local, historyPath, [
        { ...f.history, amount: "2" },
        ...f.lists.history.filter((v) => v !== f.history),
      ]);
    },
  },
  updateTransactionHistoryEntry: {
    run: () =>
      StorageUtil.updateTransactionHistoryEntry(
        ACCOUNT,
        HISTORY.transactionHash,
        { amount: "2" },
      ),
    edit: (e, f) => {
      set(
        e.local,
        historyPath,
        f.lists.history.map((v) =>
          v === f.history ? { ...f.history, amount: "2" } : v,
        ),
      );
    },
  },
  clearTransactionHistory: {
    run: () => StorageUtil.clearTransactionHistory(ACCOUNT),
    edit: (e) => {
      set(e.local, historyPath, []);
    },
  },
  setPriceCache: {
    run: () => StorageUtil.setPriceCache({ prices: { usd: 2 } }),
    edit: (e) => {
      set(e.local, ["PRICE_CACHE", "prices", "usd"], 2);
    },
  },
} satisfies Record<WriterName, WriterCase>;

// Exercise ordinary read-edit-save callers on mixed metadata as well as the
// direct replacement inputs above. Both use the same independent byte oracle.
const mixedRuns: Record<string, WriterCase["run"] | undefined> = {
  setKeystores: (f: Fixture) =>
    StorageUtil.setKeystores([malformed<KeyStore>(f.keystore)]),
  setAllBlockChains: async () =>
    StorageUtil.setAllBlockChains(
      (await StorageUtil.getAllBlockChains()).map((chain) =>
        chain.chainId === CHAIN.chainId
          ? { ...chain, chainName: "Edited" }
          : chain,
      ),
    ),
  setTokenContractsList: (f: Fixture) =>
    StorageUtil.setTokenContractsList(ACCOUNT, { ...f.token, symbol: "EDIT" }),
  setNFTCollectionsList: (f: Fixture) =>
    StorageUtil.setNFTCollectionsList(ACCOUNT, { ...f.nft, name: "Edited" }),
  setDAppsRequestData: (f: Fixture) =>
    StorageUtil.setDAppsRequestData({ ...f.request, requestId: "r2" }),
  setDAppsConnectedAccountsData: (f: Fixture) =>
    StorageUtil.setDAppsConnectedAccountsData({
      ...CONNECTION,
      blockchains: [f.chain, f.otherChain],
    }),
  setContacts: async () =>
    StorageUtil.setContacts(
      (await StorageUtil.getContacts()).map((contact) =>
        contact.address === ACCOUNT ? { ...contact, name: "Edited" } : contact,
      ),
    ),
  setSettings: async () =>
    StorageUtil.setSettings({
      ...(await StorageUtil.getSettings()),
      currency: "USD",
    }),
  setLedgerAccounts: async () =>
    StorageUtil.setLedgerAccounts(
      (await StorageUtil.getLedgerAccounts()).map((account) =>
        account.address === ACCOUNT ? { ...account, index: 7 } : account,
      ),
    ),
  setTransactionHistoryEntry: (f: Fixture) =>
    StorageUtil.setTransactionHistoryEntry(ACCOUNT, {
      ...f.history,
      amount: "2",
    }),
} satisfies Partial<Record<WriterName, WriterCase["run"]>>;

import { toCanonicalQrlAddress } from "./addressUtil";
const addedAccount = toCanonicalQrlAddress(`Q${"c".repeat(128)}`);
const junkValues: StorageJunkValue[] = [
  ...storageMutationValues.map(([, value]) => value),
  42,
  { future: true },
  { nested: [null, false, { address: "unreadable" }] },
  "unreadable",
  { invoker: origin, parentCapability: "future_capability", caveats: [] },
  Object.fromEntries([["__proto__", { retain: true }]]),
  { address: "" },
  { address: null, chainId: {}, transactionHash: false },
];
afterEach(() => {
  resetApprovalSlot();
  vi.restoreAllMocks();
});

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const canonical = (values: unknown[]) =>
  values.flatMap((value) => {
    try {
      return [toCanonicalQrlAddress(value)];
    } catch {
      return [];
    }
  });

// The read oracle applies the account migration to familiar permission fields.
// The approval oracle below uses explicit grants from the fixture.
const permissionRead = (permissions: unknown): unknown[] =>
  list(permissions).map((permission) => {
    if (
      !isRecord(permission) ||
      typeof permission.invoker !== "string" ||
      !["qrl_accounts", "qrl_chains"].includes(
        String(permission.parentCapability),
      )
    )
      return permission;
    return {
      ...permission,
      caveats: list(permission.caveats).map((caveat) => {
        if (
          !isRecord(caveat) ||
          caveat.type !== "restrictReturnedAccounts" ||
          !Array.isArray(caveat.value) ||
          caveat.value.some((value: unknown) => typeof value !== "string")
        )
          return caveat;
        return { ...caveat, value: canonical(caveat.value) };
      }),
    };
  });

const approvedChains = [CHAIN, { ...CHAIN, chainId: "0x43" }];
const approvedCaveat = {
  type: "restrictNetworkSwitching",
  value: [CHAIN.chainId, "0x43"],
};
const approvedGrants = [
  CONNECTION.permissions[0],
  {
    invoker: origin,
    parentCapability: "qrl_chains",
    caveats: [approvedCaveat],
  },
];

const checkApprovedPermissions = async (
  accounts = [ACCOUNT, OTHER_ACCOUNT],
  expected: unknown[] = approvedGrants,
) => {
  resetApprovalSlot();
  await StorageUtil.clearDAppsRequestData();
  vi.mocked(openApprovalSurface).mockImplementation(async () => {
    const requestId = getStoredValue(
      h.session,
      "DAPPS",
      "DAPPS_REQUEST_DATA",
      "requestId",
    );
    expect(requestId).toBeTypeOf("string");
    const removed = new Set(
      vi
        .spyOn(browser.runtime.onMessage, "removeListener")
        .mock.calls.map(([listener]) => listener),
    );
    const listeners = vi
      .spyOn(browser.runtime.onMessage, "addListener")
      .mock.calls.map(([listener]) => listener)
      .filter((listener) => !removed.has(listener));
    expect(listeners).toHaveLength(1);
    for (const action of [
      EXTENSION_MESSAGES.DAPP_REQUEST_IN_PROGRESS,
      EXTENSION_MESSAGES.DAPP_RESPONSE,
    ]) {
      for (const listener of listeners) {
        const result: unknown = listener(
          {
            method: "wallet_requestPermissions",
            action,
            requestId,
            hasApproved: true,
            response: {
              accounts,
              blockchains: approvedChains,
            },
          },
          { id: "mock-id", url: "chrome-extension://mock-id/index.html" },
          vi.fn(),
        );
        await result;
      }
    }
  });
  const response: Parameters<typeof restrictedMethodsMiddleware>[1] = {
    id: 1,
    jsonrpc: "2.0",
  };
  await restrictedMethodsMiddleware(
    {
      id: 1,
      jsonrpc: "2.0",
      method: "wallet_requestPermissions",
      params: [{ qrl_accounts: {} }],
      senderData: { url: origin, tabId: 1 },
    },
    response,
    vi.fn(),
    vi.fn(),
  );
  expect(response.error).toBeUndefined();
  expect(response.result).toEqual(expected);
};

// Every writer is followed by reads of all record types. Each reader must
// expose usable siblings and leave the stored bytes unchanged.
const checkReadableSiblings = async () => {
  const before = JSON.stringify({ local: h.local, session: h.session });
  const identifiable = (value: unknown, key: string) =>
    list(value).filter((item) => {
      const identity = getStoredValue(item, key);
      return typeof identity === "string" && identity.trim().length > 0;
    });
  const active = await StorageUtil.getActiveBlockChain();
  const chains = getStoredValue(h.local, "BLOCKCHAINS", "ALL_BLOCKCHAINS");
  expect(await StorageUtil.getAllBlockChains()).toEqual(
    Array.isArray(chains) ? identifiable(chains, "chainId") : QRL_BLOCKCHAINS,
  );
  expect(active.chainId).toBe(
    getStoredValue(h.local, "BLOCKCHAINS", "ACTIVE_BLOCKCHAIN") ??
      DEFAULT_BLOCKCHAIN.chainId,
  );
  expect(await StorageUtil.getActivePage()).toBe(h.local.ACTIVE_PAGE ?? "");
  expect(await StorageUtil.getActiveAccount()).toBe(
    getStoredValue(h.local, "ACCOUNTS", "ACTIVE_ACCOUNT") ?? "",
  );
  for (const state of [LockState.LOCKED, LockState.UNLOCKED])
    expect(await StorageUtil.getLockStateTimeStamp(state)).toBe(
      h.local[`LOCK_MANAGER_${state}_TIMESTAMP`] ?? 0,
    );
  for (const [root, all, field, key, read] of [
    [
      "TOKENS",
      "ALL_TOKENS",
      "tokens",
      "address",
      () => StorageUtil.getTokenContractsList(ACCOUNT),
    ],
    [
      "NFT_COLLECTIONS",
      "ALL_NFT_COLLECTIONS",
      "collections",
      "address",
      () => StorageUtil.getNFTCollectionsList(ACCOUNT),
    ],
    [
      "TX_HISTORY",
      "ALL_TX_HISTORY",
      "transactions",
      "transactionHash",
      () => StorageUtil.getTransactionHistory(ACCOUNT),
    ],
  ] as const) {
    expect(await read()).toEqual(
      identifiable(
        getStoredValue(h.local, root, all, ACCOUNT, active.chainId, field),
        key,
      ),
    );
  }
  expect(await StorageUtil.getAllAccounts()).toEqual(
    canonical(list(getStoredValue(h.local, "ACCOUNTS", "ALL_ACCOUNTS"))),
  );
  expect(await StorageUtil.getStoredAccounts()).toEqual(
    list(getStoredValue(h.local, "ACCOUNTS", "ALL_ACCOUNTS")).filter(
      (value) => typeof value === "string",
    ),
  );
  expect(await StorageUtil.getPendingTransactions(ACCOUNT)).toEqual(
    identifiable(
      getStoredValue(
        h.local,
        "TX_HISTORY",
        "ALL_TX_HISTORY",
        ACCOUNT,
        active.chainId,
        "transactions",
      ),
      "transactionHash",
    ).filter((value) => getStoredValue(value, "pendingStatus") === "pending"),
  );
  expect(await StorageUtil.getLedgerAccounts()).toEqual(
    identifiable(
      getStoredValue(h.local, "LEDGER", "LEDGER_ACCOUNTS"),
      "address",
    ),
  );
  for (const address of [ACCOUNT, OTHER_ACCOUNT, addedAccount]) {
    const ledgerAccount = identifiable(
      getStoredValue(h.local, "LEDGER", "LEDGER_ACCOUNTS"),
      "address",
    ).find((value) => getStoredValue(value, "address") === address);
    expect(await StorageUtil.getLedgerAccountByAddress(address)).toEqual(
      ledgerAccount,
    );
    expect(await StorageUtil.isLedgerAccount(address)).toBe(
      ledgerAccount !== undefined,
    );
  }
  const contacts = list(
    getStoredValue(h.local, "CONTACTS", "ALL_CONTACTS"),
  ).flatMap((value) => {
    if (!isRecord(value)) return [];
    const addresses = canonical([value.address]);
    return addresses.map((address) => ({ ...value, address }));
  });
  expect(await StorageUtil.getContacts()).toEqual(contacts);
  for (const [key, type, read] of [
    ["ACCOUNT_LABELS", "string", () => StorageUtil.getAccountLabels()],
    ["HIDDEN_ACCOUNTS", "boolean", () => StorageUtil.getHiddenAccounts()],
  ] as const) {
    const stored = h.local[key];
    expect(await read()).toEqual(
      Object.fromEntries(
        Object.entries(isRecord(stored) ? stored : {}).filter(
          ([, value]) => typeof value === type,
        ),
      ),
    );
  }
  const settings = h.local.SETTINGS;
  expect(await StorageUtil.getSettings()).toEqual(
    Object.fromEntries(
      Object.entries(isRecord(settings) ? settings : {}).filter(
        ([key, value]) => isWalletSettings({ [key]: value }),
      ),
    ),
  );
  const connection = getStoredValue(h.local, ...grantPath);
  const accounts = canonical(list(getStoredValue(connection, "accounts")));
  expect(await StorageUtil.getDAppsConnectedAccountsData(origin)).toEqual(
    accounts.length
      ? {
          ...record(connection),
          accounts,
          blockchains: identifiable(
            getStoredValue(connection, "blockchains"),
            "chainId",
          ),
          permissions: permissionRead(
            getStoredValue(connection, "permissions"),
          ),
        }
      : undefined,
  );
  expect(await StorageUtil.getPriceCache()).toEqual(
    h.local.PRICE_CACHE ?? null,
  );
  expect(await StorageUtil.getDAppsRequestData()).toEqual(
    getStoredValue(h.session, "DAPPS", "DAPPS_REQUEST_DATA"),
  );
  expect(await StorageUtil.getTransactionValues()).toEqual(
    h.local[`${active.chainId}_TRANSACTION_VALUES`] ?? {
      receiverAddress: "",
      amount: 0,
    },
  );
  if (h.local.KEYSTORES === undefined)
    expect(await StorageUtil.getKeystores()).toEqual([]);
  else await expect(StorageUtil.getKeystores()).rejects.toThrow();
  expect(JSON.stringify({ local: h.local, session: h.session })).toBe(before);
};

for (const [name, scenario] of Object.entries<WriterCase>(cases)) {
  describe(`${name} raw storage oracle`, () => {
    it.each(
      junkValues.flatMap((junk, id) =>
        [0, 1, 2].flatMap((position) =>
          [false, true].map((mixedMetadata) => ({
            junk,
            position,
            id,
            mixedMetadata,
          })),
        ),
      ),
    )(
      "preserves junk $id at position $position, mixed metadata $mixedMetadata and every unrelated field",
      async ({ junk, position, mixedMetadata }) => {
        vi.spyOn(Date, "now").mockReturnValue(123);
        const f = fixture(junk, position, mixedMetadata);
        seed(f.local, f.session);
        const expected = {
          local: record(h.copy(f.local)),
          session: record(h.copy(f.session)),
        };
        await checkReadableSiblings();
        scenario.edit(expected, f);
        const run = mixedMetadata
          ? (mixedRuns[name] ?? scenario.run)
          : scenario.run;
        await run(f);
        expect(JSON.stringify({ local: h.local, session: h.session })).toBe(
          JSON.stringify(expected),
        );
        await checkReadableSiblings();
        await checkApprovedPermissions();
        expect(await authorized()).toBe(
          approvedChains.some(
            (chain) =>
              chain.chainId ===
              getStoredValue(h.local, "BLOCKCHAINS", "ACTIVE_BLOCKCHAIN"),
          ),
        );
        await checkReadableSiblings();
        const saved = JSON.stringify(h.local);
        await checkApprovedPermissions();
        expect(JSON.stringify(h.local)).toBe(saved);
        await checkRevocations();
      },
    );
  });
}

const authorized = async () =>
  (
    await checkAccountAndChainHaveBeenAuthorized(
      {
        method: "qrl_sendTransaction",
        params: [{ from: ACCOUNT, to: OTHER_ACCOUNT, value: "0x1" }],
        senderData: { url: origin },
      },
      undefined,
      true,
    )
  ).canProceed;

const checkRevocations = async () => {
  const approved = {
    local: record(h.copy(h.local)),
    session: record(h.copy(h.session)),
  };
  const chainId = (await StorageUtil.getActiveBlockChain()).chainId;
  for (const kind of ["account", "chain", "connection"] as const) {
    seed(approved.local, approved.session);
    const expected = {
      local: record(h.copy(approved.local)),
      session: record(h.copy(approved.session)),
    };
    if (kind === "connection") remove(expected.local, grantPath);
    else if (kind === "account") {
      set(
        expected.local,
        [...grantPath, "accounts"],
        list(getStoredValue(expected.local, ...grantPath, "accounts")).filter(
          (value) => value !== ACCOUNT,
        ),
      );
      editCaveatValues(expected, "restrictReturnedAccounts", (values) =>
        values.filter((value) => value !== ACCOUNT),
      );
    } else {
      set(
        expected.local,
        [...grantPath, "blockchains"],
        list(
          getStoredValue(expected.local, ...grantPath, "blockchains"),
        ).filter((value) => getStoredValue(value, "chainId") !== chainId),
      );
      editCaveatValues(expected, "restrictNetworkSwitching", (values) =>
        values.filter((value) => value !== chainId),
      );
    }
    const revoke = () =>
      kind === "account"
        ? StorageUtil.removeAccountFromAllDApps(ACCOUNT)
        : kind === "chain"
          ? StorageUtil.removeDAppChain(origin, chainId)
          : StorageUtil.clearDAppsConnectedAccountsData(origin);
    for (let repeat = 0; repeat < 2; repeat++) {
      await revoke();
      expect(JSON.stringify({ local: h.local, session: h.session })).toBe(
        JSON.stringify(expected),
      );
      expect(await authorized()).toBe(false);
      await checkReadableSiblings();
    }
  }
};

describe("nested permission approval preservation", () => {
  it.each(
    junkValues.flatMap((junk, id) =>
      [0, 1, 2].flatMap((position) =>
        ["permissions", "caveats", "values"].map((level) => ({
          junk,
          id,
          position,
          level,
        })),
      ),
    ),
  )(
    "returns both approved grants and preserves opaque $level entry $id at $position",
    async ({ junk, position, level }) => {
      const weave = (values: unknown[]) => [
        ...values.slice(0, position),
        junk,
        ...values.slice(position),
      ];
      const grants = approvedGrants.map((permission) => ({
        ...permission,
        caveats:
          level === "caveats"
            ? weave(permission.caveats)
            : permission.caveats.map((caveat: unknown) => ({
                ...record(caveat),
                value:
                  level === "values"
                    ? weave(list(getStoredValue(caveat, "value")))
                    : getStoredValue(caveat, "value"),
              })),
      }));
      const f = fixture(junk, position);
      set(f.local, grantPath, {
        ...CONNECTION,
        blockchains: approvedChains,
        permissions: level === "permissions" ? weave(grants) : grants,
      });
      seed(f.local, f.session);
      const expected = {
        local: record(h.copy(f.local)),
        session: record(h.copy(f.session)),
      };
      editCaveatValues(expected, "restrictNetworkSwitching", (values) =>
        values.filter(
          (value) =>
            typeof value !== "string" ||
            value.trim() === "" ||
            value === CHAIN.chainId ||
            value === "0x43",
        ),
      );
      const saved = JSON.stringify(expected.local);
      for (let repeat = 0; repeat < 2; repeat++) {
        await checkApprovedPermissions();
        expect(await authorized()).toBe(true);
        expect(JSON.stringify(h.local)).toBe(saved);
        await checkReadableSiblings();
      }
      await checkRevocations();
    },
  );
});

describe("round 3 real grant callers", () => {
  it.each(
    [
      [{ future: true }],
      [
        {
          invoker: origin,
          parentCapability: "qrl_accounts",
          caveats: [{ type: "future", value: [] }],
        },
      ],
      [
        {
          invoker: origin,
          parentCapability: "qrl_chains",
          caveats: [{ type: "restrictNetworkSwitching", value: null }],
        },
      ],
    ].map((permissions) => ({ permissions })),
  )(
    "revokes account authorization with unfamiliar permissions %j",
    async ({ permissions }) => {
      const f = fixture(null, 1);
      const grant = { ...CONNECTION, permissions };
      set(f.local, ["DAPPS", "ALL_DAPPS"], {});
      seed(f.local, f.session);
      await StorageUtil.setDAppsConnectedAccountsData(malformed(grant));
      expect(await authorized()).toBe(true);
      await StorageUtil.removeAccountFromAllDApps(ACCOUNT);
      expect(await authorized()).toBe(false);
      expect(getStoredValue(h.local, ...grantPath)).toEqual({
        ...grant,
        accounts: [OTHER_ACCOUNT],
      });
    },
  );

  it.each(junkValues)(
    "adds and removes only the requested grant chain with %j siblings",
    async (junk) => {
      const f = fixture(junk, 1);
      const raw = { ...CONNECTION, blockchains: [CHAIN, junk], future: junk };
      set(f.local, grantPath, raw);
      seed(f.local, f.session);
      await includeChainForUrlOrigin({ urlOrigin: origin, chainId: "0x43" });
      expect(getStoredValue(h.local, ...grantPath, "blockchains")).toEqual(
        h.copy([CHAIN, junk, f.otherChain]),
      );
      await excludeChainForUrlOrigin({
        urlOrigin: origin,
        chainId: CHAIN.chainId,
      });
      expect(getStoredValue(h.local, ...grantPath, "blockchains")).toEqual(
        h.copy([junk, f.otherChain]),
      );
      expect(getStoredValue(h.local, ...grantPath, "future")).toEqual(
        h.copy(junk),
      );
    },
  );

  it("matches a raw request ID even with unreadable request metadata", async () => {
    const f = fixture(null, 0);
    set(f.session, ["DAPPS", "DAPPS_REQUEST_DATA", "method"], false);
    seed(f.local, f.session);
    await StorageUtil.clearDAppsRequestDataForRequestId("different");
    expect(h.session).toEqual(f.session);
    await StorageUtil.clearDAppsRequestDataForRequestId("r1");
    remove(f.session, ["DAPPS", "DAPPS_REQUEST_DATA"]);
    expect(h.session).toEqual(f.session);
  });

  it.each(["__proto__", "constructor"])(
    "revokes readable accounts and caveats under %s without trusting envelopes",
    async (key) => {
      const f = fixture(null, 1);
      const grant = {
        urlOrigin: false,
        accounts: ["junk", `0x${ACCOUNT.slice(1)}`, null],
        permissions: [
          false,
          {
            caveats: [
              null,
              { type: "restrictReturnedAccounts", value: [ACCOUNT, 4] },
            ],
          },
        ],
      };
      set(f.local, ["DAPPS", "ALL_DAPPS", key], grant);
      seed(f.local, f.session);
      await StorageUtil.removeAccountFromAllDApps(ACCOUNT);
      expect(getStoredValue(h.local, "DAPPS", "ALL_DAPPS", key)).toEqual({
        ...grant,
        accounts: ["junk", null],
        permissions: [
          false,
          { caveats: [null, { type: "restrictReturnedAccounts", value: [4] }] },
        ],
      });
    },
  );
});

describe("targeted field boundaries", () => {
  it.each([undefined, null, ""])(
    "clears an existing QRNS registry with %j",
    async (qrnsRegistryAddress) => {
      const f = fixture(false, 1);
      set(
        f.local,
        ["BLOCKCHAINS", "ALL_BLOCKCHAINS"],
        [{ ...f.chain, qrnsRegistryAddress: ACCOUNT }, null, f.otherChain],
      );
      seed(f.local, f.session);
      await StorageUtil.setAllBlockChains([
        { ...CHAIN, qrnsRegistryAddress },
        f.otherChain,
      ]);
      expect(getStoredValue(h.local, "BLOCKCHAINS", "ALL_BLOCKCHAINS")).toEqual(
        [f.chain, null, f.otherChain],
      );
    },
  );

  it("replaces the known pending request fields and preserves nested unknown fields", async () => {
    const f = fixture(false, 1);
    const raw = {
      ...f.request,
      authorizedChainId: CHAIN.chainId,
      params: { old: true },
      requestData: {
        future: false,
        senderData: { url: origin, tabId: 5, future: { keep: true } },
      },
      phishingResult: {
        isDomainPhishing: false,
        matchedDomain: "old.example",
        future: [null],
      },
    };
    set(f.session, ["DAPPS", "DAPPS_REQUEST_DATA"], raw);
    seed(f.local, f.session);
    await StorageUtil.setDAppsRequestData({
      method: "qrl_accounts",
      requestId: "r2",
      params: [],
      requestData: { senderData: { url: "https://other.example" } },
      phishingResult: { isDomainPhishing: false },
    });
    expect(getStoredValue(h.session, "DAPPS", "DAPPS_REQUEST_DATA")).toEqual({
      method: "qrl_accounts",
      requestId: "r2",
      future: false,
      params: [],
      requestData: {
        future: false,
        senderData: { url: "https://other.example", future: { keep: true } },
      },
      phishingResult: { isDomainPhishing: false, future: [null] },
    });
  });

  it.each(junkValues)(
    "removes a chain through unreadable surrounding metadata %j",
    async (junk) => {
      const f = fixture(junk, 1);
      const raw = {
        ...f.grant,
        urlOrigin: junk,
        permissions: [
          junk,
          {
            caveats: [
              junk,
              {
                type: "restrictNetworkSwitching",
                value: [CHAIN.chainId, junk, "0x43"],
                future: junk,
              },
            ],
            future: junk,
          },
        ],
      };
      set(f.local, grantPath, raw);
      seed(f.local, f.session);
      await excludeChainForUrlOrigin({
        urlOrigin: origin,
        chainId: CHAIN.chainId,
      });
      const expected = {
        ...raw,
        blockchains: [junk, f.otherChain],
        permissions: [
          junk,
          {
            caveats: [
              junk,
              {
                type: "restrictNetworkSwitching",
                value: [junk, "0x43"],
                future: junk,
              },
            ],
            future: junk,
          },
        ],
      };
      expect(JSON.stringify(getStoredValue(h.local, ...grantPath))).toBe(
        JSON.stringify(expected),
      );
    },
  );
});

it("replaces omitted valid fields and retains omitted unfamiliar metadata", async () => {
  const f = fixture(false, 1);
  set(f.local, historyPath, [
    { ...f.history, nonce: 7, maxFeePerGas: { future: true } },
    null,
  ]);
  set(f.local, ["SETTINGS"], {
    currency: "EUR",
    language: "nl",
    themePreference: { future: true },
    future: false,
  });
  set(f.local, ["PRICE_CACHE"], {
    prices: { usd: 1, eur: null, gbp: false, future: 42 },
    future: false,
  });
  seed(f.local, f.session);
  await StorageUtil.setTransactionHistoryEntry(ACCOUNT, HISTORY);
  expect(getStoredValue(h.local, ...historyPath)).toEqual([
    { ...f.history, maxFeePerGas: { future: true } },
    null,
  ]);
  await StorageUtil.setSettings({ currency: "USD" });
  expect(h.local.SETTINGS).toEqual({
    currency: "USD",
    themePreference: { future: true },
    future: false,
  });
  await StorageUtil.setPriceCache({ prices: { usd: 2 } });
  expect(h.local.PRICE_CACHE).toEqual({
    prices: { usd: 2, gbp: false, future: 42 },
    future: false,
  });
});

it.each(["0X2A", "0x002a", "42"])(
  "revokes the authorized chain identity %s",
  async (chainId) => {
    const f = fixture(null, 1);
    const grant = {
      ...CONNECTION,
      blockchains: [{ ...CHAIN, chainId }, null],
      permissions: [
        {
          future: true,
          caveats: [
            { type: "restrictNetworkSwitching", value: [chainId, null] },
          ],
        },
      ],
    };
    set(f.local, grantPath, grant);
    seed(f.local, f.session);
    expect(await authorized()).toBe(true);
    await excludeChainForUrlOrigin({
      urlOrigin: origin,
      chainId: CHAIN.chainId,
    });
    expect(await authorized()).toBe(false);
    expect(getStoredValue(h.local, ...grantPath)).toEqual({
      ...grant,
      blockchains: [null],
      permissions: [
        {
          future: true,
          caveats: [{ type: "restrictNetworkSwitching", value: [null] }],
        },
      ],
    });
  },
);

it.each(junkValues.map((permissions, id) => ({ permissions, id })))(
  "adds a chain while preserving opaque permission metadata $id",
  async ({ permissions }) => {
    const f = fixture(permissions, 1);
    const raw = { ...CONNECTION, blockchains: [CHAIN, null], permissions };
    set(f.local, grantPath, raw);
    seed(f.local, f.session);
    await includeChainForUrlOrigin({ urlOrigin: origin, chainId: "0x43" });
    expect(getStoredValue(h.local, ...grantPath)).toEqual(
      h.copy({
        ...raw,
        blockchains: [CHAIN, null, f.otherChain],
        permissions:
          permissions === undefined
            ? approvedGrants
            : Array.isArray(permissions)
              ? [...list(permissions), ...approvedGrants]
              : permissions,
      }),
    );
  },
);

const accountAliases = [
  ACCOUNT,
  ACCOUNT.toLowerCase(),
  `q${ACCOUNT.slice(1)}`,
  `0x${ACCOUNT.slice(1)}`,
  `0X${ACCOUNT.slice(1)}`,
];
it.each(accountAliases)(
  "returns canonical approved permissions for account alias %s",
  async (account) => {
    const f = fixture(null, 1);
    seed(f.local, f.session);
    await checkApprovedPermissions([account, OTHER_ACCOUNT]);
    expect(await authorized()).toBe(true);
    await checkReadableSiblings();
  },
);

it("returns no permissions after an empty account approval", async () => {
  const f = fixture(null, 1);
  seed(f.local, f.session);
  await checkApprovedPermissions([], []);
  expect(await authorized()).toBe(false);
  expect(
    await StorageUtil.getDAppsConnectedAccountsData(origin),
  ).toBeUndefined();
  expect(getStoredValue(h.local, ...grantPath, "accounts")).toEqual([null]);
  await checkReadableSiblings();
});

it("rejects permission approval when persisting the grant fails", async () => {
  const f = fixture(null, 1);
  seed(f.local, f.session);
  const saved = JSON.stringify(h.local);
  vi.spyOn(h.localArea, "set").mockRejectedValueOnce(
    new Error("Storage failed"),
  );
  await expect(
    updatePermissionsForUrlOrigin({
      urlOrigin: origin,
      accounts: [ACCOUNT, OTHER_ACCOUNT],
      blockchains: approvedChains,
    }),
  ).rejects.toThrow("Storage failed");
  expect(JSON.stringify(h.local)).toBe(saved);
});

const chainAliases = [CHAIN.chainId, "0X2A", "0x002a", "42"];
for (const kind of ["account", "chain", "connection"] as const) {
  it.each(
    junkValues.flatMap((junk, id) =>
      accountAliases.map((account, index) => ({
        junk,
        id,
        account,
        chain: chainAliases[index % chainAliases.length],
        index,
      })),
    ),
  )(
    `${kind} revocation removes every readable match through malformed envelopes: $id / $index`,
    async ({ junk, account, chain }) => {
      const f = fixture(junk, 1);
      const accountCaveat = {
        type: "restrictReturnedAccounts",
        value: [account, junk, OTHER_ACCOUNT],
        future: junk,
      };
      const chainCaveat = {
        type: "restrictNetworkSwitching",
        value: [chain, junk, "0x43"],
        future: junk,
      };
      const permission = {
        invoker: junk,
        parentCapability: junk,
        caveats: [junk, accountCaveat, chainCaveat],
        future: junk,
      };
      const raw = {
        urlOrigin: junk,
        accounts: [account, junk, OTHER_ACCOUNT],
        blockchains: [
          { chainId: chain, chainName: junk },
          junk,
          { chainId: "0x43" },
        ],
        permissions: [junk, permission],
        future: junk,
      };
      set(f.local, grantPath, raw);
      seed(f.local, f.session);
      const expected = {
        local: record(h.copy(f.local)),
        session: record(h.copy(f.session)),
      };
      const revoke = () =>
        kind === "account"
          ? StorageUtil.removeAccountFromAllDApps(ACCOUNT)
          : kind === "chain"
            ? StorageUtil.removeDAppChain(origin, CHAIN.chainId)
            : StorageUtil.clearDAppsConnectedAccountsData(origin);
      if (kind === "connection") remove(expected.local, grantPath);
      else
        set(expected.local, grantPath, {
          ...raw,
          ...(kind === "account"
            ? { accounts: [junk, OTHER_ACCOUNT] }
            : { blockchains: [junk, { chainId: "0x43" }] }),
          permissions: [
            junk,
            {
              ...permission,
              caveats: [
                junk,
                kind === "account"
                  ? { ...accountCaveat, value: [junk, OTHER_ACCOUNT] }
                  : accountCaveat,
                kind === "chain"
                  ? { ...chainCaveat, value: [junk, "0x43"] }
                  : chainCaveat,
              ],
            },
          ],
        });
      await revoke();
      expect(JSON.stringify({ local: h.local, session: h.session })).toBe(
        JSON.stringify(expected),
      );
      expect(await authorized()).toBe(false);
      await revoke();
      expect(JSON.stringify({ local: h.local, session: h.session })).toBe(
        JSON.stringify(expected),
      );
    },
  );
}

for (const name of [
  "clearAllAccountData",
  "removeLedgerAccountFromAllAccounts",
] as const) {
  it.each(
    junkValues.flatMap((junk, id) =>
      accountAliases.map((account, index) => ({ junk, id, account, index })),
    ),
  )(
    `${name} revokes aliases and preserves opaque siblings: $id / $index`,
    async ({ junk, account }) => {
      const f = fixture(junk, 1);
      for (const [root, all] of [
        ["TOKENS", "ALL_TOKENS"],
        ["NFT_COLLECTIONS", "ALL_NFT_COLLECTIONS"],
        ["TX_HISTORY", "ALL_TX_HISTORY"],
      ]) {
        const data = getStoredValue(f.local, root, all, ACCOUNT);
        remove(f.local, [root, all, ACCOUNT]);
        set(f.local, [root, all, account], data);
      }
      set(
        f.local,
        ["ACCOUNTS", "ALL_ACCOUNTS"],
        [junk, account, OTHER_ACCOUNT, account],
      );
      seed(f.local, f.session);
      const expected = {
        local: record(h.copy(f.local)),
        session: record(h.copy(f.session)),
      };
      if (name === "clearAllAccountData") {
        for (const [root, all] of [
          ["TOKENS", "ALL_TOKENS"],
          ["NFT_COLLECTIONS", "ALL_NFT_COLLECTIONS"],
          ["TX_HISTORY", "ALL_TX_HISTORY"],
        ])
          remove(expected.local, [root, all, account]);
      } else
        set(
          expected.local,
          ["ACCOUNTS", "ALL_ACCOUNTS"],
          [junk, OTHER_ACCOUNT],
        );
      await StorageUtil[name](ACCOUNT);
      expect(JSON.stringify({ local: h.local, session: h.session })).toBe(
        JSON.stringify(expected),
      );
      await StorageUtil[name](ACCOUNT);
      expect(JSON.stringify({ local: h.local, session: h.session })).toBe(
        JSON.stringify(expected),
      );
    },
  );
}
