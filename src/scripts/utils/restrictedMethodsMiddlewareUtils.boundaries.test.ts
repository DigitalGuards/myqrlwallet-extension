import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toChecksumAddress } from "@theqrl/wallet.js";
import browser from "webextension-polyfill";
import { profileStorageKey } from "@/utilities/profileStorage";
import { getStoredValue, isRecord } from "@/utilities/storageGuards";
import {
  buildDAppSendTransactionErrorData,
  checkAccountAndChainHaveBeenAuthorized,
  checkAccountHasBeenAuthorized,
  checkWalletAddQrlChainParams,
  checkWalletRequestPermissionParams,
  checkWalletSwitchQrlChainParams,
  checkWalletWatchAssetParams,
  excludeChainForUrlOrigin,
  extractPendingDAppTransactionHash,
  includeChainForUrlOrigin,
  revalidateAuthorizedDAppRequest,
} from "./restrictedMethodsMiddlewareUtils";

type GrantWrite = Parameters<
  typeof import("@/utilities/storageUtil").default.setDAppsConnectedAccountsData
>[0];

const { readGrants, readChains, readActiveChain, writeGrants, assertNetwork } =
  vi.hoisted(() => ({
    readGrants: vi.fn<() => Promise<unknown>>(),
    readChains: vi.fn<() => Promise<unknown>>(),
    readActiveChain: vi.fn<() => Promise<unknown>>(),
    writeGrants: vi.fn<(value: GrantWrite) => Promise<void>>(),
    assertNetwork: vi.fn<(url: string) => Promise<void>>(),
  }));

vi.mock("@/utilities/storageUtil", async (importOriginal) => ({
  default: {
    ...(await importOriginal<typeof import("@/utilities/storageUtil")>())
      .default,
    getDAppsConnectedAccountsData: readGrants,
    getAllBlockChains: readChains,
    getActiveBlockChain: readActiveChain,
    setDAppsConnectedAccountsData: writeGrants,
  },
}));
vi.mock("../lockManager/lockManager", () => ({
  default: {
    isLocked: () => Promise.resolve({ isLocked: false, hasPasswordSet: true }),
  },
}));
vi.mock("@/configuration/releaseProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/configuration/releaseProfile")>()),
  assertV3Network: assertNetwork,
}));

const ACCOUNT = toChecksumAddress(`Q${"a".repeat(128)}`);
const ORIGIN = "https://dapp.example";
const CHAIN = { chainId: "0x301825", defaultRpcUrl: "https://rpc.example" };
const request = (method: string, params: unknown) => ({
  method,
  params,
  senderData: { url: ORIGIN },
});
const approval = () => ({
  method: "qrl_signMessage",
  params: [ACCOUNT, "0x1234"],
  authorizedChainId: CHAIN.chainId,
  requestData: { senderData: { url: ORIGIN } },
});

beforeEach(() => {
  readGrants
    .mockReset()
    .mockResolvedValue({ accounts: [ACCOUNT], blockchains: [CHAIN] });
  readChains.mockReset().mockResolvedValue([CHAIN]);
  readActiveChain.mockReset().mockResolvedValue(CHAIN);
  writeGrants.mockReset().mockResolvedValue(undefined);
  assertNetwork.mockReset().mockResolvedValue(undefined);
});

describe("authorization input boundaries", () => {
  it.each([
    { accounts: "unreadable", blockchains: [{ chainId: "0x1" }, CHAIN] },
    { accounts: [ACCOUNT], blockchains: [{ chainId: "0x1" }, null, CHAIN] },
    {
      accounts: [ACCOUNT],
      blockchains: [{ chainId: "0x1" }, { chainId: 17 }, CHAIN],
    },
    { accounts: [ACCOUNT], blockchains: { chainId: CHAIN.chainId } },
  ])(
    "refuses authorization when the grant view is unreadable (%j)",
    async (grants) => {
      readGrants.mockResolvedValue(grants);
      const before = structuredClone(grants);
      await expect(
        checkAccountAndChainHaveBeenAuthorized(
          request("qrl_signMessage", [ACCOUNT, "0x1234"]),
        ),
      ).rejects.toThrow("stored dApp connection");
      expect(writeGrants).not.toHaveBeenCalled();
      expect(grants).toEqual(before);
    },
  );

  it.each([null, 17, {}, []])(
    "keeps chain identity readable with unfamiliar optional metadata (%j)",
    async (metadata) => {
      const chain = {
        ...CHAIN,
        chainName: metadata,
        qrnsRegistryAddress: metadata,
      };
      readGrants.mockResolvedValue({
        accounts: [ACCOUNT],
        blockchains: [chain],
      });
      readChains.mockResolvedValue([chain]);
      expect(
        await checkAccountAndChainHaveBeenAuthorized(
          request("qrl_signMessage", [ACCOUNT, "0x1234"]),
        ),
      ).toMatchObject({ canProceed: true, authorizedChainId: CHAIN.chainId });
      expect(
        await checkWalletSwitchQrlChainParams({ chainId: CHAIN.chainId }),
      ).toEqual({
        canProceed: true,
        proceedError: undefined,
      });
    },
  );

  it.each<[string, unknown]>([
    ["qrl_sendTransaction", [{ from: ACCOUNT }]],
    ["qrl_sendTransaction", { 0: { from: ACCOUNT } }],
    ["personal_sign", ["0x1234", ACCOUNT]],
    ["personal_sign", { 0: "0x1234", 1: ACCOUNT }],
    ["qrl_signMessage", [ACCOUNT, "0x1234"]],
    ["wallet_getCapabilities", [ACCOUNT]],
  ])(
    "keeps positional account authorization for %s",
    async (method, params) => {
      const result = await checkAccountHasBeenAuthorized(
        request(method, params),
      );
      expect(result.canProceed).toBe(true);
      expect(result.proceedError.message).toBe(
        `The requested account ${ACCOUNT} has not been authorized by the user.`,
      );
    },
  );

  it.each([undefined, null, 17, [], [null], [{ from: {} }], { 0: [] }])(
    "refuses malformed transaction params (%s)",
    async (params) => {
      expect(
        (
          await checkAccountHasBeenAuthorized(
            request("qrl_sendTransaction", params),
          )
        ).canProceed,
      ).toBe(false);
    },
  );

  it.each([
    null,
    [],
    17,
    { domain: [] },
    { domain: null },
    { domain: "0x301825" },
  ])("refuses malformed typed-data records (%s)", async (typedData) => {
    for (const data of [typedData, JSON.stringify(typedData)]) {
      const result = await checkAccountAndChainHaveBeenAuthorized(
        request("qrl_signTypedData", [ACCOUNT, data]),
      );
      expect(result).toMatchObject({
        canProceed: false,
        proceedError: {
          code: -32602,
          message: "The wallet cannot parse the typed-data request.",
        },
      });
    }
  });

  it.each([
    { domain: { chainId: "3151909" } },
    { domain: { name: "Example" } },
    {},
  ])("keeps valid typed-data chain binding (%j)", async (typedData) => {
    for (const data of [typedData, JSON.stringify(typedData)]) {
      const result = await checkAccountAndChainHaveBeenAuthorized(
        request("qrl_signTypedData", [ACCOUNT, data]),
      );
      expect(result).toMatchObject({
        canProceed: true,
        authorizedChainId: CHAIN.chainId,
      });
    }
  });

  it.each([
    undefined,
    null,
    17,
    {},
    { ...approval(), authorizedChainId: 17 },
    { ...approval(), requestData: { senderData: [] } },
  ])("refuses a malformed stored approval (%s)", async (value) => {
    expect(await revalidateAuthorizedDAppRequest(value)).toMatchObject({
      canProceed: false,
      proceedError: { code: 4100 },
    });
    expect(assertNetwork).not.toHaveBeenCalled();
  });

  it.each([true, false, [], [1], {}])(
    "refuses non-numeric transaction value shapes (%s)",
    async (value) => {
      expect(
        await checkAccountAndChainHaveBeenAuthorized(
          request("qrl_sendTransaction", [{ from: ACCOUNT, value }]),
        ),
      ).toMatchObject({
        canProceed: false,
        proceedError: {
          code: -32602,
          message: "The transaction contains an invalid value.",
        },
      });
    },
  );

  it("refuses an active network whose RPC URL is unreadable", async () => {
    readActiveChain.mockResolvedValue({
      chainId: CHAIN.chainId,
      defaultRpcUrl: 17,
    });
    expect(await revalidateAuthorizedDAppRequest(approval())).toMatchObject({
      canProceed: false,
      proceedError: {
        code: 4900,
        message: "The wallet cannot read the active network.",
      },
    });
    expect(assertNetwork).not.toHaveBeenCalled();
  });

  it("rechecks grants after pinned network validation", async () => {
    assertNetwork.mockImplementation(() => {
      readGrants.mockResolvedValue({ accounts: [], blockchains: [CHAIN] });
      return Promise.resolve();
    });
    expect(await revalidateAuthorizedDAppRequest(approval())).toMatchObject({
      canProceed: false,
      proceedError: { code: 4100 },
    });
    expect(assertNetwork).toHaveBeenCalledExactlyOnceWith(CHAIN.defaultRpcUrl);
  });
  it("rechecks the current approval params after network validation", async () => {
    const pendingApproval = approval();
    assertNetwork.mockImplementation(() => {
      pendingApproval.params = [
        toChecksumAddress(`Q${"b".repeat(128)}`),
        "0x1234",
      ];
      return Promise.resolve();
    });
    expect(
      await revalidateAuthorizedDAppRequest(pendingApproval),
    ).toMatchObject({
      canProceed: false,
      proceedError: { code: 4100 },
    });
  });

  it("refuses authorization when stored account grants are unreadable", async () => {
    readGrants.mockResolvedValue({ accounts: ACCOUNT, blockchains: [CHAIN] });
    await expect(
      checkAccountHasBeenAuthorized(
        request("qrl_signMessage", [ACCOUNT, "0x1234"]),
      ),
    ).rejects.toThrow("stored dApp connection");
    expect(writeGrants).not.toHaveBeenCalled();
  });
});

describe("stored grants survive chain changes", () => {
  const first = { chainId: "0x1", futureField: { retained: ["first"] } };
  const second = { chainId: "0x2", futureField: { retained: ["second"] } };
  const dappsKey = profileStorageKey("DAPPS");
  const readLocal = vi.spyOn(browser.storage.local, "get");
  const writeLocal = vi.spyOn(browser.storage.local, "set");
  let local: Record<string, unknown>;
  const seedGrants = (grants: unknown) => {
    local = {
      [dappsKey]: { ALL_DAPPS: { [ORIGIN]: structuredClone(grants) } },
    };
  };
  const storedGrants = () =>
    getStoredValue(local, dappsKey, "ALL_DAPPS", ORIGIN);

  beforeEach(() => {
    local = {};
    readLocal
      .mockReset()
      .mockImplementation((key: unknown) =>
        Promise.resolve(
          typeof key === "string"
            ? { [key]: structuredClone(local[key]) }
            : structuredClone(local),
        ),
      );
    writeLocal.mockReset().mockImplementation((values: unknown) => {
      if (!isRecord(values))
        return Promise.reject(new Error("Invalid local storage write"));
      Object.assign(local, structuredClone(values));
      return Promise.resolve();
    });
  });

  afterEach(() => {
    expect(writeGrants).not.toHaveBeenCalled();
    expect(readGrants).not.toHaveBeenCalled();
  });

  it("appends one chain and preserves existing records and order", async () => {
    seedGrants({
      accounts: [ACCOUNT],
      blockchains: [first, second],
    });
    await includeChainForUrlOrigin({
      urlOrigin: `${ORIGIN}/path`,
      chainId: CHAIN.chainId,
    });
    expect(storedGrants()).toEqual({
      urlOrigin: ORIGIN,
      accounts: [ACCOUNT],
      blockchains: [first, second, CHAIN],
      permissions: [
        {
          invoker: ORIGIN,
          parentCapability: "qrl_accounts",
          caveats: [{ type: "restrictReturnedAccounts", value: [ACCOUNT] }],
        },
        {
          invoker: ORIGIN,
          parentCapability: "qrl_chains",
          caveats: [
            {
              type: "restrictNetworkSwitching",
              value: ["0x1", "0x2", CHAIN.chainId],
            },
          ],
        },
      ],
    });
  });

  it("preserves the stored record when the chain is already granted", async () => {
    const existing = { ...CHAIN, futureField: "retained" };
    seedGrants({
      accounts: [ACCOUNT],
      blockchains: [first, existing, second],
    });
    await includeChainForUrlOrigin({
      urlOrigin: ORIGIN,
      chainId: CHAIN.chainId.toUpperCase(),
    });
    expect(storedGrants()).toEqual(
      expect.objectContaining({ blockchains: [first, existing, second] }),
    );
  });

  it("removes only the selected chain and preserves the remaining order", async () => {
    seedGrants({
      accounts: [ACCOUNT],
      blockchains: [first, CHAIN, second],
    });
    await excludeChainForUrlOrigin({
      urlOrigin: ORIGIN,
      chainId: CHAIN.chainId.toUpperCase(),
    });
    expect(storedGrants()).toEqual(
      expect.objectContaining({
        accounts: [ACCOUNT],
        blockchains: [first, second],
      }),
    );
  });

  it.each([undefined, null])(
    "preserves grants when the requested chain ID is missing (%s)",
    async (chainId) => {
      const grants = {
        accounts: [ACCOUNT],
        blockchains: [first, second],
      };
      seedGrants(grants);
      await includeChainForUrlOrigin({ urlOrigin: ORIGIN, chainId });
      expect(storedGrants()).toEqual(grants);
      expect(writeLocal).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, {}])(
    "keeps empty defaults for missing legacy grants (%s)",
    async (grants) => {
      seedGrants(grants);
      await includeChainForUrlOrigin({
        urlOrigin: ORIGIN,
        chainId: CHAIN.chainId,
      });
      expect(storedGrants()).toEqual(
        expect.objectContaining({ accounts: [], blockchains: [CHAIN] }),
      );
    },
  );

  it("preserves explicitly stored null accounts when adding a chain", async () => {
    seedGrants({ accounts: null, blockchains: null });
    await includeChainForUrlOrigin({
      urlOrigin: ORIGIN,
      chainId: CHAIN.chainId,
    });
    expect(storedGrants()).toEqual(
      expect.objectContaining({ accounts: null, blockchains: [CHAIN] }),
    );
  });

  it.each([null, "unreadable", [ACCOUNT, null]])(
    "keeps opaque metadata and revokes only the selected chain (%j)",
    async (accounts) => {
      const permission = {
        futureField: { retained: true },
        caveats: [
          {
            type: "restrictNetworkSwitching",
            value: [first.chainId, null, CHAIN.chainId],
          },
        ],
      };
      const grants = {
        urlOrigin: ORIGIN,
        accounts,
        blockchains: [first, null, { chainId: 17 }],
        futureField: { retained: true },
      };
      seedGrants({ ...grants, permissions: [null, permission] });
      await includeChainForUrlOrigin({
        urlOrigin: ORIGIN,
        chainId: CHAIN.chainId,
      });
      expect(storedGrants()).toEqual(
        expect.objectContaining({
          ...grants,
          blockchains: [...grants.blockchains, CHAIN],
        }),
      );
      expect(getStoredValue(storedGrants(), "permissions")).toEqual(
        expect.arrayContaining([null, permission]),
      );
      await excludeChainForUrlOrigin({
        urlOrigin: ORIGIN,
        chainId: CHAIN.chainId,
      });
      expect(storedGrants()).toEqual(expect.objectContaining(grants));
      expect(getStoredValue(storedGrants(), "permissions")).toEqual(
        expect.arrayContaining([
          null,
          {
            ...permission,
            caveats: [
              {
                type: "restrictNetworkSwitching",
                value: [first.chainId, null],
              },
            ],
          },
        ]),
      );
    },
  );

  it("refuses sparse stored chain lists before writing", async () => {
    const chains: unknown[] = [];
    chains.length = 1;
    readChains.mockResolvedValue(chains);
    await expect(
      includeChainForUrlOrigin({ urlOrigin: ORIGIN, chainId: CHAIN.chainId }),
    ).rejects.toThrow("stored networks");
    expect(writeLocal).not.toHaveBeenCalled();
  });

  it("refuses a write when the network list contains an unreadable record", async () => {
    readChains.mockResolvedValue([first, { chainId: 17 }, CHAIN]);
    await expect(
      includeChainForUrlOrigin({ urlOrigin: ORIGIN, chainId: CHAIN.chainId }),
    ).rejects.toThrow("stored networks");
    expect(writeLocal).not.toHaveBeenCalled();
  });
});

describe("validator results and approval errors", () => {
  it("keeps add-chain errors and the order of unexpected keys", async () => {
    const result = await checkWalletAddQrlChainParams({
      unexpected: true,
      extra: true,
    });
    expect(result.proceedError?.message).toBe(
      "Received unexpected keys on object parameter. Unsupported keys: unexpected,extra",
    );
    const invalidId = await checkWalletSwitchQrlChainParams({ chainId: 17 });
    expect(invalidId.proceedError?.message).toBe(
      "Expected 0x-prefixed, unpadded, non-zero hexadecimal string 'chainId'. Received: 17",
    );
  });

  it("keeps a legacy null native currency readable", async () => {
    readChains.mockResolvedValue([{ ...CHAIN, nativeCurrency: null }]);
    expect(
      await checkWalletAddQrlChainParams({
        chainId: CHAIN.chainId,
        chainName: "Example",
        rpcUrls: [CHAIN.defaultRpcUrl],
        nativeCurrency: null,
      }),
    ).toEqual({ canProceed: true, proceedError: undefined });
  });

  it("keeps the asynchronous asset and permission validator results", async () => {
    const asset = checkWalletWatchAssetParams({
      type: "ZRC20",
      options: { address: ACCOUNT, symbol: "TEST", decimals: 18 },
    });
    const permission = checkWalletRequestPermissionParams({ qrl_accounts: {} });
    expect(asset).toBeInstanceOf(Promise);
    expect(permission).toBeInstanceOf(Promise);
    await expect(asset).resolves.toEqual({
      canProceed: true,
      proceedError: undefined,
    });
    await expect(permission).resolves.toEqual({
      canProceed: true,
      proceedError: undefined,
    });
    await expect(checkWalletRequestPermissionParams({})).resolves.toMatchObject(
      { canProceed: false, proceedError: { code: -32601 } },
    );
  });

  it("keeps serialization failures as rejected validator promises", async () => {
    const result = checkWalletWatchAssetParams(1n);
    await expect(result).rejects.toThrow(TypeError);
  });

  it.each([
    null,
    [],
    { error: [] },
    { error: { data: [] } },
    { error: { data: { transactionHash: 17 } } },
  ])("ignores malformed pending transaction hashes (%s)", (response) => {
    expect(extractPendingDAppTransactionHash(response)).toBeUndefined();
  });

  it("refuses array-shaped error payloads", () => {
    expect(
      buildDAppSendTransactionErrorData({ error: ["unreadable"] }),
    ).toEqual({});
  });

  it("preserves every error field while hoisting the pending hash", () => {
    const error = {
      message: "pending",
      data: { transactionHash: "0xpending", pending: true },
      futureField: { retained: true },
    };
    expect(buildDAppSendTransactionErrorData({ error })).toEqual({
      ...error,
      transactionHash: "0xpending",
    });
  });
});
