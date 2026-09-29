vi.mock("@/configuration/releaseProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/configuration/releaseProfile")>()),
  assertV3Network: vi.fn().mockResolvedValue(undefined),
}));

// The real LockManager pulls in the @theqrl/web3 crypto graph; the
// authorization prechecks only need its isLocked() answer (L6). Held in a
// plain object so the per-describe vi.restoreAllMocks() cannot strip the
// implementation out from under it.
const { lockState } = vi.hoisted(() => ({
  lockState: { isLocked: false, hasPasswordSet: true },
}));
vi.mock("../lockManager/lockManager", () => ({
  __esModule: true,
  default: { isLocked: async () => ({ ...lockState }) },
}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toChecksumAddress } from "@theqrl/wallet.js";
import { assertV3Network } from "@/configuration/releaseProfile";
import StorageUtil from "@/utilities/storageUtil";
import { RESTRICTED_METHODS } from "../constants/requestConstants";
import {
  checkAccountHasBeenAuthorized,
  checkAccountAndChainHaveBeenAuthorized,
  checkWalletAddQrlChainParams,
  pickDefaultRpcUrl,
  normalizeChainId,
  revalidateAuthorizedDAppRequest,
} from "./restrictedMethodsMiddlewareUtils";

const ACCOUNT = `Q${"a".repeat(128)}`;
const ORIGIN = "https://audit-dapp.example";
const CHECKSUM_ACCOUNT = toChecksumAddress(ACCOUNT);
const WRONG_CHECKSUM_ACCOUNT = `${CHECKSUM_ACCOUNT.slice(0, 1)}${
  CHECKSUM_ACCOUNT[1] === CHECKSUM_ACCOUNT[1].toUpperCase()
    ? CHECKSUM_ACCOUNT[1].toLowerCase()
    : CHECKSUM_ACCOUNT[1].toUpperCase()
}${CHECKSUM_ACCOUNT.slice(2)}`;

const request = (method: string, params: unknown[]) =>
  ({
    id: 1,
    jsonrpc: "2.0",
    method,
    params,
    senderData: { url: `${ORIGIN}/request` },
  }) as never;

describe("dApp chain authorization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(StorageUtil, "getDAppsConnectedAccountsData").mockResolvedValue({
      urlOrigin: ORIGIN,
      accounts: [ACCOUNT],
      blockchains: [{ chainId: "0x301825" } as never],
      permissions: [],
    });
    vi.spyOn(StorageUtil, "getActiveBlockChain").mockResolvedValue({
      chainId: "0x301825",
    } as never);
  });

  it("canonicalizes supported decimal and hexadecimal chain IDs", () => {
    expect(normalizeChainId(3151909)).toBe("0x301825");
    expect(normalizeChainId("3151909")).toBe("0x301825");
    expect(normalizeChainId("0X0301825")).toBe("0x301825");
    expect(normalizeChainId("1.5")).toBeUndefined();
    expect(normalizeChainId(-1)).toBeUndefined();
  });

  it("allows an authorized transaction on the active chain", async () => {
    const result = await checkAccountAndChainHaveBeenAuthorized(
      request(RESTRICTED_METHODS.QRL_SEND_TRANSACTION, [{ from: ACCOUNT }]),
    );

    expect(result.canProceed).toBe(true);
    expect(result).toMatchObject({ authorizedChainId: "0x301825" });
  });

  it.each(["0x301825", "3151909", 3151909])(
    "accepts an explicit SDK transaction chain matching the wallet (%s)",
    async (chainId) => {
      const result = await checkAccountAndChainHaveBeenAuthorized(
        request(RESTRICTED_METHODS.QRL_SEND_TRANSACTION, [
          { from: ACCOUNT, to: CHECKSUM_ACCOUNT, chainId, value: "0x0" },
        ]),
      );
      expect(result).toMatchObject({
        canProceed: true,
        authorizedChainId: "0x301825",
      });
    },
  );

  it.each(["0x539", "0x1"])(
    "rejects a different explicit transaction chain before approval (%s)",
    async (chainId) => {
      const result = await checkAccountAndChainHaveBeenAuthorized(
        request(RESTRICTED_METHODS.QRL_SEND_TRANSACTION, [
          { from: ACCOUNT, chainId },
        ]),
      );
      expect(result.canProceed).toBe(false);
      expect(result.proceedError?.message).toContain(
        "does not match the active, authorized wallet chain",
      );
    },
  );

  it.each([null, undefined, "", "0x0", "invalid", -1, 1.5, {}])(
    "rejects a malformed explicit transaction chain (%s)",
    async (chainId) => {
      const result = await checkAccountAndChainHaveBeenAuthorized(
        request(RESTRICTED_METHODS.QRL_SEND_TRANSACTION, [
          { from: ACCOUNT, chainId },
        ]),
      );
      expect(result.canProceed).toBe(false);
      expect(result.proceedError?.message).toContain("invalid chain ID");
    },
  );

  it("rechecks the declared transaction chain against its approval context", async () => {
    const result = await revalidateAuthorizedDAppRequest({
      method: RESTRICTED_METHODS.QRL_SEND_TRANSACTION,
      params: [{ from: ACCOUNT, chainId: "0x539" }],
      requestId: "request-id",
      authorizedChainId: "0x301825",
      requestData: { senderData: { url: `${ORIGIN}/request` } },
    });
    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain(
      "does not match the active, authorized wallet chain",
    );
  });

  it("checks pinned RPC identity even for an explicitly matching transaction chain", async () => {
    vi.mocked(assertV3Network).mockRejectedValueOnce(
      new Error("The RPC does not match the pinned v3 Private network."),
    );
    const result = await revalidateAuthorizedDAppRequest({
      method: RESTRICTED_METHODS.QRL_SEND_TRANSACTION,
      params: [{ from: ACCOUNT, chainId: "0x301825" }],
      requestId: "request-id",
      authorizedChainId: "0x301825",
      requestData: { senderData: { url: `${ORIGIN}/request` } },
    });
    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain("pinned v3 Private network");
  });

  it.each([
    `Q${"b".repeat(40)}`,
    WRONG_CHECKSUM_ACCOUNT,
    `q${CHECKSUM_ACCOUNT.slice(1)}`,
    `0x${CHECKSUM_ACCOUNT.slice(1)}`,
  ])("rejects an invalid transaction recipient (%s)", async (to) => {
    const result = await checkAccountAndChainHaveBeenAuthorized(
      request(RESTRICTED_METHODS.QRL_SEND_TRANSACTION, [{ from: ACCOUNT, to }]),
    );

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain(
      "uppercase-Q QIP-55 address",
    );
  });

  it("accepts checksum-case variants of an authorized signing account", async () => {
    const upperPrefixLowerBody = `Q${ACCOUNT.slice(1).toLowerCase()}`;
    const result = await checkAccountAndChainHaveBeenAuthorized(
      request(RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA_V4, [
        upperPrefixLowerBody,
        { domain: { chainId: "0x301825" } },
      ]),
    );

    expect(result.canProceed).toBe(true);
    expect(result).toMatchObject({ authorizedChainId: "0x301825" });
  });

  it("rejects a signing account with one different nibble", async () => {
    const differentAccount = `Q${`${ACCOUNT.slice(1, -1)}8`.toLowerCase()}`;
    const result = await checkAccountHasBeenAuthorized(
      request(RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA_V4, [
        differentAccount,
        { domain: { chainId: "0x301825" } },
      ]),
    );

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain("has not been authorized");
  });

  it("rejects before approval when the active chain was not granted", async () => {
    vi.mocked(StorageUtil.getActiveBlockChain).mockResolvedValue({
      chainId: "0x1",
    } as never);

    const result = await checkAccountAndChainHaveBeenAuthorized(
      request(RESTRICTED_METHODS.QRL_SEND_TRANSACTION, [{ from: ACCOUNT }]),
    );

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain("not authorized");
  });

  it("rejects typed data whose declared chain differs from the active chain", async () => {
    const result = await checkAccountAndChainHaveBeenAuthorized(
      request(RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA_V4, [
        ACCOUNT,
        { domain: { chainId: "0x1" } },
      ]),
    );

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain(
      "not the active wallet chain",
    );
  });

  it("rejects malformed serialized typed data", async () => {
    const result = await checkAccountAndChainHaveBeenAuthorized(
      request(RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA_V4, [ACCOUNT, "{"]),
    );

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain("cannot parse");
  });

  it("revalidates the bound chain immediately before execution", async () => {
    vi.mocked(StorageUtil.getActiveBlockChain).mockResolvedValue({
      chainId: "0x1",
    } as never);

    const result = await revalidateAuthorizedDAppRequest({
      method: RESTRICTED_METHODS.PERSONAL_SIGN,
      params: ["0x1234", ACCOUNT],
      requestId: "request-id",
      authorizedChainId: "0x301825",
      requestData: { senderData: { url: `${ORIGIN}/request` } },
    });

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain(
      "not the active wallet chain",
    );
  });
});

describe("custom-chain QRNS registry validation", () => {
  const chain = {
    chainName: "Local QRL",
    chainId: "0x301825",
    nativeCurrency: { name: "Quanta", symbol: "Quanta", decimals: 18 },
    rpcUrls: ["https://rpc.example"],
    blockExplorerUrls: [],
    iconUrls: [],
    isCustomChain: true,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(StorageUtil, "getAllBlockChains").mockResolvedValue([]);
  });

  it.each([
    `Q${"b".repeat(40)}`,
    WRONG_CHECKSUM_ACCOUNT,
    `q${CHECKSUM_ACCOUNT.slice(1)}`,
    `0x${CHECKSUM_ACCOUNT.slice(1)}`,
    `Q${CHECKSUM_ACCOUNT.slice(1).toLowerCase()}`,
  ])("rejects a non-QIP-55 QRNS registry (%s)", async (qrnsRegistryAddress) => {
    const result = await checkWalletAddQrlChainParams(
      { ...chain, qrnsRegistryAddress } as never,
      true,
    );

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain(
      "uppercase-Q QIP-55 address",
    );
  });

  it.each([undefined, null, "", CHECKSUM_ACCOUNT])(
    "accepts an empty or canonical QRNS registry (%s)",
    async (qrnsRegistryAddress) => {
      const result = await checkWalletAddQrlChainParams(
        { ...chain, qrnsRegistryAddress } as never,
        true,
      );

      expect(result.canProceed).toBe(true);
    },
  );
});

// Fork-only coverage: the PQ signing methods qrl_signMessage and
// qrl_signTypedData are MyQRLWallet additions, so upstream's authorization
// tests do not exercise them. They must be bound to the authorized chain
// exactly like their EVM-style counterparts.
describe("dApp chain authorization for PQ signing methods", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(StorageUtil, "getDAppsConnectedAccountsData").mockResolvedValue({
      urlOrigin: ORIGIN,
      accounts: [ACCOUNT],
      blockchains: [{ chainId: "0x301825" } as never],
      permissions: [],
    });
    vi.spyOn(StorageUtil, "getActiveBlockChain").mockResolvedValue({
      chainId: "0x301825",
    } as never);
  });

  it("rejects qrl_signTypedData whose declared chain differs from the active chain", async () => {
    const result = await checkAccountAndChainHaveBeenAuthorized(
      request(RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA, [
        ACCOUNT,
        { domain: { chainId: "0x1" } },
      ]),
    );

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain(
      "not the active wallet chain",
    );
  });

  it("allows qrl_signTypedData whose decimal declared chain matches the active chain", async () => {
    const result = await checkAccountAndChainHaveBeenAuthorized(
      request(RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA, [
        ACCOUNT,
        { domain: { chainId: 3151909 } },
      ]),
    );

    expect(result.canProceed).toBe(true);
    expect(result).toMatchObject({ authorizedChainId: "0x301825" });
  });

  it("binds qrl_signTypedData without a declared chain to the active chain", async () => {
    const result = await checkAccountAndChainHaveBeenAuthorized(
      request(RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA, [
        ACCOUNT,
        { domain: { name: "QuantaSwap" } },
      ]),
    );

    expect(result.canProceed).toBe(true);
    expect(result).toMatchObject({ authorizedChainId: "0x301825" });
  });

  it("allows qrl_signMessage on the authorized active chain", async () => {
    const result = await checkAccountAndChainHaveBeenAuthorized(
      request(RESTRICTED_METHODS.QRL_SIGN_MESSAGE, [ACCOUNT, "0xdeadbeef"]),
    );

    expect(result.canProceed).toBe(true);
    expect(result).toMatchObject({ authorizedChainId: "0x301825" });
  });

  it("rejects qrl_signMessage when the active chain was not granted", async () => {
    vi.mocked(StorageUtil.getActiveBlockChain).mockResolvedValue({
      chainId: "0x1",
    } as never);

    const result = await checkAccountAndChainHaveBeenAuthorized(
      request(RESTRICTED_METHODS.QRL_SIGN_MESSAGE, [ACCOUNT, "0xdeadbeef"]),
    );

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain("not authorized");
  });

  it("revalidation rejects a stored qrl_signMessage request after a chain switch", async () => {
    vi.mocked(StorageUtil.getActiveBlockChain).mockResolvedValue({
      chainId: "0x1",
    } as never);

    const result = await revalidateAuthorizedDAppRequest({
      method: RESTRICTED_METHODS.QRL_SIGN_MESSAGE,
      params: [ACCOUNT, "0xdeadbeef"],
      requestId: "request-id",
      authorizedChainId: "0x301825",
      requestData: { senderData: { url: `${ORIGIN}/request` } },
    });

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain(
      "not the active wallet chain",
    );
  });

  it("revalidation rejects a stored request missing its authorized chain", async () => {
    const result = await revalidateAuthorizedDAppRequest({
      method: RESTRICTED_METHODS.QRL_SIGN_MESSAGE,
      params: [ACCOUNT, "0xdeadbeef"],
      requestId: "request-id",
      requestData: { senderData: { url: `${ORIGIN}/request` } },
    });

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain(
      "missing its authorized chain context",
    );
  });

  it.each([
    RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA_V4,
    RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA,
  ])("revalidation rejects an approved %s request", async (method) => {
    const result = await revalidateAuthorizedDAppRequest({
      method,
      params: [ACCOUNT, { domain: { chainId: "0x301825" } }],
      requestId: "request-id",
      authorizedChainId: "0x301825",
      requestData: { senderData: { url: `${ORIGIN}/request` } },
    });

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.code).toBe(4200);
    expect(result.proceedError?.message).toContain(
      "versioned 64-byte address layout",
    );
  });
});

describe("wallet_addQRLChain rpcUrls validation (L5)", () => {
  const chain = {
    chainName: "Some chain",
    chainId: "0x301825",
    nativeCurrency: { name: "Quanta", symbol: "Quanta", decimals: 18 },
    blockExplorerUrls: [],
    iconUrls: [],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(StorageUtil, "getAllBlockChains").mockResolvedValue([]);
  });

  it("accepts a dApp list where every url is https on a public host", async () => {
    const result = await checkWalletAddQrlChainParams({
      ...chain,
      rpcUrls: ["https://rpc.example", "https://rpc2.example"],
    } as never);

    expect(result.canProceed).toBe(true);
  });

  it.each([
    ["http://localhost:8545", "loopback by name"],
    ["http://127.0.0.1:8545", "loopback by address"],
    ["https://192.168.1.10:8545", "private LAN"],
    ["https://10.0.0.5:8545", "private range"],
    ["https://172.16.0.5:8545", "private range"],
    ["https://169.254.1.1:8545", "link local"],
    ["https://node.local:8545", "mDNS host"],
    ["http://rpc.example", "cleartext http"],
  ])(
    "rejects a dApp list smuggling %s (%s) past an https entry",
    async (url) => {
      const result = await checkWalletAddQrlChainParams({
        ...chain,
        rpcUrls: ["https://rpc.example", url],
      } as never);

      expect(result.canProceed).toBe(false);
      expect(result.proceedError?.message).toContain("rpcUrls");
    },
  );

  it.each([
    ["https://localhost./", "trailing-dot loopback name"],
    ["https://printer.local./", "trailing-dot mDNS host"],
    ["https://node.internal./", "trailing-dot internal suffix"],
    ["https://[::ffff:127.0.0.1]:8545/", "IPv4-mapped loopback"],
    ["https://[::ffff:192.168.1.10]:8545/", "IPv4-mapped private LAN"],
    ["https://[64:ff9b::7f00:1]:8545/", "NAT64-embedded loopback"],
    ["https://[64:ff9b:1::7f00:1]:8545/", "NAT64 /48 prefix"],
    ["https://100.64.0.1:8545/", "carrier-grade NAT"],
    ["https://100.127.255.254:8545/", "carrier-grade NAT upper bound"],
    ["https://[fc00::1]:8545/", "IPv6 unique local, low end"],
    ["https://[fdff:1234::1]:8545/", "IPv6 unique local, high end"],
    ["https://[fe80::1]:8545/", "IPv6 link local, low end"],
    ["https://[febf::1]:8545/", "IPv6 link local, high end"],
  ])("rejects a dApp list reaching a private host via %s (%s)", async (url) => {
    const result = await checkWalletAddQrlChainParams({
      ...chain,
      rpcUrls: ["https://rpc.example", url],
    } as never);

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain("rpcUrls");
  });

  it.each([
    "https://rpc.example",
    "https://rpc.example./",
    "https://[2001:db8::ffff:1]:8545/",
    "https://[::ffff:8.8.8.8]:8545/",
    "https://101.64.0.1:8545/",
  ])("still accepts the public https endpoint %s", async (url) => {
    const result = await checkWalletAddQrlChainParams({
      ...chain,
      rpcUrls: [url],
    } as never);

    expect(result.canProceed).toBe(true);
  });

  it("rejects a dApp list whose first entry is unacceptable", async () => {
    // The entry the wallet would adopt as its default endpoint.
    const result = await checkWalletAddQrlChainParams({
      ...chain,
      rpcUrls: ["http://127.0.0.1:8545", "https://rpc.example"],
    } as never);

    expect(result.canProceed).toBe(false);
  });

  it("still lets the user add their own local node from the wallet form", async () => {
    const result = await checkWalletAddQrlChainParams(
      {
        ...chain,
        rpcUrls: ["http://127.0.0.1:8545"],
        defaultRpcUrl: "http://127.0.0.1:8545",
        defaultBlockExplorerUrl: "",
        defaultIconUrl: "",
        isTestnet: true,
        defaultWsRpcUrl: "",
        isCustomChain: true,
      } as never,
      true,
    );

    expect(result.canProceed).toBe(true);
  });

  it.each([
    "http://localhost./",
    "http://[::ffff:127.0.0.1]:8545/",
    "http://100.64.0.1:8545/",
    "http://[fe80::1]:8545/",
  ])("still lets the wallet form add the local node %s", async (url) => {
    const result = await checkWalletAddQrlChainParams(
      {
        ...chain,
        rpcUrls: [url],
        defaultRpcUrl: url,
        defaultBlockExplorerUrl: "",
        defaultIconUrl: "",
        isTestnet: true,
        defaultWsRpcUrl: "",
        isCustomChain: true,
      } as never,
      true,
    );

    expect(result.canProceed).toBe(true);
  });
});

describe("pickDefaultRpcUrl (L5)", () => {
  it("takes the first entry the wallet is willing to use", () => {
    expect(pickDefaultRpcUrl(["https://a.example", "https://b.example"])).toBe(
      "https://a.example",
    );
  });

  it("skips entries the wallet would refuse", () => {
    expect(
      pickDefaultRpcUrl(["http://127.0.0.1:8545", "https://b.example"]),
    ).toBe("https://b.example");
  });

  it("takes a local node only when local hosts are allowed", () => {
    expect(pickDefaultRpcUrl(["http://127.0.0.1:8545"])).toBe("");
    expect(pickDefaultRpcUrl(["http://127.0.0.1:8545"], true)).toBe(
      "http://127.0.0.1:8545",
    );
  });

  it.each([undefined, null, "https://a.example", [], [42]])(
    "answers with an empty string for %s",
    (rpcUrls) => {
      expect(pickDefaultRpcUrl(rpcUrls)).toBe("");
    },
  );
});

// L6: while the wallet is locked, qrl_accounts, the provider state and
// wallet_getPermissions all report nothing, so the authorization prechecks
// must not answer differently for an authorized and an unauthorized address
// either. Both reach the approval surface, which shows the unlock screen,
// and revalidateAuthorizedDAppRequest enforces the grant after unlock.
describe("locked-wallet authorization oracle (L6)", () => {
  const UNAUTHORIZED_ACCOUNT = `Q${"b".repeat(128)}`;

  const capabilitiesRequest = (from: string) =>
    request(RESTRICTED_METHODS.WALLET_GET_CAPABILITIES, [from, ["0x301825"]]);
  const sendTransactionRequest = (from: string) =>
    request(RESTRICTED_METHODS.QRL_SEND_TRANSACTION, [{ from }]);

  beforeEach(() => {
    vi.restoreAllMocks();
    lockState.isLocked = false;
    vi.spyOn(StorageUtil, "getDAppsConnectedAccountsData").mockResolvedValue({
      urlOrigin: ORIGIN,
      accounts: [ACCOUNT],
      blockchains: [{ chainId: "0x301825" } as never],
      permissions: [],
    });
    vi.spyOn(StorageUtil, "getActiveBlockChain").mockResolvedValue({
      chainId: "0x301825",
    } as never);
  });

  afterEach(() => {
    lockState.isLocked = false;
  });

  it("answers wallet_getCapabilities the same for both accounts while locked", async () => {
    lockState.isLocked = true;

    const authorized = await checkAccountHasBeenAuthorized(
      capabilitiesRequest(ACCOUNT),
    );
    const unauthorized = await checkAccountHasBeenAuthorized(
      capabilitiesRequest(UNAUTHORIZED_ACCOUNT),
    );

    expect(unauthorized.canProceed).toBe(authorized.canProceed);
    expect(authorized.canProceed).toBe(true);
  });

  it("answers qrl_sendTransaction the same for both accounts while locked", async () => {
    lockState.isLocked = true;

    const authorized = await checkAccountAndChainHaveBeenAuthorized(
      sendTransactionRequest(ACCOUNT),
    );
    const unauthorized = await checkAccountAndChainHaveBeenAuthorized(
      sendTransactionRequest(UNAUTHORIZED_ACCOUNT),
    );

    expect(unauthorized.canProceed).toBe(authorized.canProceed);
    expect(unauthorized).toMatchObject({
      canProceed: true,
      authorizedChainId: "0x301825",
    });
  });

  it("answers qrl_sendTransaction the same for an origin with no grant at all while locked", async () => {
    lockState.isLocked = true;
    vi.mocked(StorageUtil.getDAppsConnectedAccountsData).mockResolvedValue({
      urlOrigin: ORIGIN,
      accounts: [],
      blockchains: [],
      permissions: [],
    });

    const result = await checkAccountAndChainHaveBeenAuthorized(
      sendTransactionRequest(UNAUTHORIZED_ACCOUNT),
    );

    expect(result).toMatchObject({
      canProceed: true,
      authorizedChainId: "0x301825",
    });
  });

  it("keeps the unlocked wallet_getCapabilities distinction", async () => {
    const authorized = await checkAccountHasBeenAuthorized(
      capabilitiesRequest(ACCOUNT),
    );
    const unauthorized = await checkAccountHasBeenAuthorized(
      capabilitiesRequest(UNAUTHORIZED_ACCOUNT),
    );

    expect(authorized.canProceed).toBe(true);
    expect(unauthorized.canProceed).toBe(false);
    expect(unauthorized.proceedError?.message).toContain(
      "has not been authorized",
    );
  });

  it("keeps the unlocked qrl_sendTransaction distinction", async () => {
    const authorized = await checkAccountAndChainHaveBeenAuthorized(
      sendTransactionRequest(ACCOUNT),
    );
    const unauthorized = await checkAccountAndChainHaveBeenAuthorized(
      sendTransactionRequest(UNAUTHORIZED_ACCOUNT),
    );

    expect(authorized).toMatchObject({
      canProceed: true,
      authorizedChainId: "0x301825",
    });
    expect(unauthorized.canProceed).toBe(false);
    expect(unauthorized.proceedError?.message).toContain(
      "has not been authorized",
    );
  });

  it("keeps the unlocked chain-grant refusal for an origin with no grant", async () => {
    vi.mocked(StorageUtil.getDAppsConnectedAccountsData).mockResolvedValue({
      urlOrigin: ORIGIN,
      accounts: [ACCOUNT],
      blockchains: [],
      permissions: [],
    });

    const result = await checkAccountAndChainHaveBeenAuthorized(
      sendTransactionRequest(ACCOUNT),
    );

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain("not authorized to use");
  });

  it("revalidation still refuses an unauthorized account while locked", async () => {
    lockState.isLocked = true;

    const result = await revalidateAuthorizedDAppRequest({
      method: RESTRICTED_METHODS.QRL_SEND_TRANSACTION,
      params: [{ from: UNAUTHORIZED_ACCOUNT }],
      requestId: "request-id",
      authorizedChainId: "0x301825",
      requestData: { senderData: { url: `${ORIGIN}/request` } },
    });

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain("has not been authorized");
  });

  it("revalidation still refuses an ungranted chain while locked", async () => {
    lockState.isLocked = true;
    vi.mocked(StorageUtil.getDAppsConnectedAccountsData).mockResolvedValue({
      urlOrigin: ORIGIN,
      accounts: [ACCOUNT],
      blockchains: [],
      permissions: [],
    });

    const result = await revalidateAuthorizedDAppRequest({
      method: RESTRICTED_METHODS.QRL_SIGN_MESSAGE,
      params: [ACCOUNT, "0xdeadbeef"],
      requestId: "request-id",
      authorizedChainId: "0x301825",
      requestData: { senderData: { url: `${ORIGIN}/request` } },
    });

    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toContain("not authorized to use");
  });
});
