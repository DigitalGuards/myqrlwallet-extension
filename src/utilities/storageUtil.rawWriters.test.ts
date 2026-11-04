// Grant, revocation and field-boundary tests for the raw storage writers.
// The per-writer oracle runs in storageUtil.rawWriters.<group>.test.ts.
// Import the oracle first: it registers the storage mocks before
// StorageUtil loads.
import {
  approvedChains,
  approvedGrants,
  authorized,
  cases,
  checkApprovedPermissions,
  checkReadableSiblings,
  checkRevocations,
  editCaveatValues,
  fixture,
  grantPath,
  h,
  historyPath,
  junkValues,
  list,
  origin,
  record,
  remove,
  resetOracleState,
  seed,
  set,
  writerGroups,
} from "./__mocks__/storageRawWriterOracle";
import { afterEach, describe, expect, it, vi } from "vitest";
import StorageUtil from "./storageUtil";
import { getStoredValue } from "./storageGuards";
import { malformed } from "@/test-utils/malformed";
import {
  ACCOUNT,
  OTHER_ACCOUNT,
  CHAIN,
  HISTORY,
  CONNECTION,
} from "./__mocks__/storageFixtures";
import {
  includeChainForUrlOrigin,
  excludeChainForUrlOrigin,
  updatePermissionsForUrlOrigin,
} from "@/scripts/utils/restrictedMethodsMiddlewareUtils";

afterEach(resetOracleState);

it("runs every raw writer in exactly one oracle group", () => {
  expect(Object.values(writerGroups).flat().sort()).toEqual(
    Object.keys(cases).sort(),
  );
});

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
    "clears an existing QNS registry with %j",
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
