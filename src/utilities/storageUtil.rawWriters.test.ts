import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyStore } from "@theqrl/web3";
import StorageUtil, { LockState } from "./storageUtil";
import { getStoredValue, isRecord } from "./storageGuards";
import { malformed } from "@/test-utils/malformed";
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
} from "@/scripts/utils/restrictedMethodsMiddlewareUtils";

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
const fixture = (junk: unknown, position: number) => {
  const weave = (values: unknown[]) => [
    ...values.slice(0, position),
    junk,
    ...values.slice(position),
  ];
  const chain = {
    ...CHAIN,
    future: junk,
    nativeCurrency: { ...CHAIN.nativeCurrency, future: junk },
  };
  const otherChain = { ...CHAIN, chainId: "0x43", future: junk };
  const token = { ...TOKEN, future: junk };
  const otherToken = { ...TOKEN, address: "token-b", future: junk };
  const nft = { ...NFT, future: junk };
  const otherNFT = { ...NFT, address: "nft-b", future: junk };
  const history = { ...HISTORY, future: junk };
  const otherHistory = { ...HISTORY, transactionHash: "hash-b", future: junk };
  const ledger = { ...LEDGER, future: junk };
  const otherLedger = { ...LEDGER, address: OTHER_ACCOUNT, future: junk };
  const contact = { address: ACCOUNT, name: "First", future: junk };
  const otherContact = { address: OTHER_ACCOUNT, name: "Second", future: junk };
  const keystore = { address: ACCOUNT, crypto: {}, future: junk };
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
  const permissions = [
    { future: junk },
    {
      invoker: origin,
      parentCapability: "qrl_accounts",
      future: junk,
      caveats: [
        { type: "future", value: junk },
        {
          type: "restrictReturnedAccounts",
          value: lists.accounts,
          future: junk,
        },
      ],
    },
    {
      invoker: origin,
      parentCapability: "qrl_chains",
      caveats: [
        {
          type: "restrictNetworkSwitching",
          value: [CHAIN.chainId],
          future: junk,
        },
      ],
      future: junk,
    },
  ];
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
  const request = { method: "qrl_accounts", requestId: "r1", future: junk };
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
    SETTINGS: { themePreference: "dark", currency: "EUR", future: junk },
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
          v === f.chain ? { ...f.chain, chainName: "Edited" } : v,
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
    edit: () => {},
  },
  addDAppChain: {
    run: () => StorageUtil.addDAppChain(origin, { ...CHAIN, chainId: "0x44" }),
    edit: (e, f) => {
      set(
        e.local,
        [...grantPath, "blockchains"],
        [...f.lists.chains, { ...CHAIN, chainId: "0x44" }],
      );
      set(
        e.local,
        [...grantPath, "permissions"],
        [
          f.permissions[0],
          f.permissions[1],
          {
            ...f.permissions[2],
            caveats: [
              {
                type: "restrictNetworkSwitching",
                value: [CHAIN.chainId, "0x44"],
                future: f.junk,
              },
            ],
          },
        ],
      );
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
      set(
        e.local,
        [...grantPath, "permissions"],
        [
          f.permissions[0],
          f.permissions[1],
          {
            ...f.permissions[2],
            caveats: [
              { type: "restrictNetworkSwitching", value: [], future: f.junk },
            ],
          },
        ],
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
      set(
        e.local,
        [...grantPath, "permissions"],
        [
          f.permissions[0],
          {
            ...f.permissions[1],
            caveats: [
              { type: "future", value: f.junk },
              {
                type: "restrictReturnedAccounts",
                value: accounts,
                future: f.junk,
              },
            ],
          },
          f.permissions[2],
        ],
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

import { toCanonicalQrlAddress } from "./addressUtil";
const addedAccount = toCanonicalQrlAddress(`Q${"c".repeat(128)}`);
const junkValues: unknown[] = [
  null,
  "",
  false,
  42,
  { future: true },
  { nested: [null, false, { address: "unreadable" }] },
  "unreadable",
  { address: "" },
  { address: null, chainId: {}, transactionHash: false },
];
afterEach(() => vi.restoreAllMocks());
for (const [name, scenario] of Object.entries<WriterCase>(cases)) {
  describe(`${name} raw storage oracle`, () => {
    it.each(
      junkValues.flatMap((junk, id) =>
        [0, 1, 2].map((position) => ({ junk, position, id })),
      ),
    )(
      "preserves junk $id at position $position and every unrelated field",
      async ({ junk, position }) => {
        vi.spyOn(Date, "now").mockReturnValue(123);
        const f = fixture(junk, position);
        seed(f.local, f.session);
        const expected = {
          local: record(h.copy(f.local)),
          session: record(h.copy(f.session)),
        };
        scenario.edit(expected, f);
        await scenario.run(f);
        expect(JSON.stringify({ local: h.local, session: h.session })).toBe(
          JSON.stringify(expected),
        );
      },
    );
  });
}

const authorized = async () =>
  (
    await checkAccountAndChainHaveBeenAuthorized(
      malformed({
        id: "raw-revocation",
        jsonrpc: "2.0",
        method: "qrl_sendTransaction",
        params: [{ from: ACCOUNT, to: OTHER_ACCOUNT, value: "0x1" }],
        senderData: { url: origin },
      }),
      undefined,
      true,
    )
  ).canProceed;

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
      expect(getStoredValue(h.local, ...grantPath, "blockchains")).toEqual([
        CHAIN,
        junk,
        f.otherChain,
      ]);
      await excludeChainForUrlOrigin({
        urlOrigin: origin,
        chainId: CHAIN.chainId,
      });
      expect(getStoredValue(h.local, ...grantPath, "blockchains")).toEqual([
        junk,
        f.otherChain,
      ]);
      expect(getStoredValue(h.local, ...grantPath, "future")).toEqual(junk);
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

it.each(junkValues)(
  "adds a chain without changing opaque permission metadata %j",
  async (permissions) => {
    const f = fixture(permissions, 1);
    const raw = { ...CONNECTION, blockchains: [CHAIN, null], permissions };
    set(f.local, grantPath, raw);
    seed(f.local, f.session);
    await includeChainForUrlOrigin({ urlOrigin: origin, chainId: "0x43" });
    expect(getStoredValue(h.local, ...grantPath)).toEqual({
      ...raw,
      blockchains: [CHAIN, null, f.otherChain],
    });
  },
);
