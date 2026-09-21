vi.mock("@/configuration/releaseProfile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/configuration/releaseProfile")>()),
  assertV3Network: vi.fn().mockResolvedValue(undefined),
}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toChecksumAddress } from "@theqrl/wallet.js";
import StorageUtil from "@/utilities/storageUtil";
import { RESTRICTED_METHODS } from "../constants/requestConstants";
import {
  checkAccountHasBeenAuthorized,
  checkAccountAndChainHaveBeenAuthorized,
  checkWalletAddQrlChainParams,
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
