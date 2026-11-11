import { profileStorageKey } from "@/utilities/profileStorage";
import { isAddQrlChainParameters } from "@/utilities/approvalGuards";
import { malformed } from "@/test-utils/malformed";
import { isRecord } from "@/utilities/storageGuards";
import { DEFAULT_BLOCKCHAIN } from "@/configuration/qrlBlockchainConfig";
import type {
  Json,
  JsonRpcRequest,
  PendingJsonRpcResponse,
} from "@theqrl/qrl-wallet-provider/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { toChecksumAddress } from "@theqrl/wallet.js";
import type LockManager from "../lockManager/lockManager";
import type { openApprovalSurface } from "../utils/approvalSurface";
import { claimApprovalSlot, resetApprovalSlot } from "../utils/approvalSlot";
import {
  POPUP_RESPONSE_TIMEOUT_MS,
  restrictedMethodsMiddleware,
} from "./restrictedMethodsMiddleware";

const { mockIsLocked, mockOpenApprovalSurface } = vi.hoisted(() => ({
  mockIsLocked: vi
    .fn<typeof LockManager.isLocked>()
    .mockResolvedValue({ isLocked: false, hasPasswordSet: true }),
  mockOpenApprovalSurface: vi
    .fn<typeof openApprovalSurface>()
    .mockResolvedValue(undefined),
}));

vi.mock("../lockManager/lockManager", () => ({
  __esModule: true,
  default: { isLocked: mockIsLocked },
}));
vi.mock("../phishing/phishingDetector", () => ({
  checkDomain: () => ({ isDomainPhishing: false }),
}));
vi.mock("../utils/approvalSurface", () => ({
  openApprovalSurface: mockOpenApprovalSurface,
}));

const mockedBrowser = vi.mocked(browser, true);
const ORIGIN = "https://dapp.example";
const ACCOUNT = toChecksumAddress(`Q${"a".repeat(128)}`);
const INVALID_PARAMS = -32602;

const setupStorage = () => {
  const records: Record<string, unknown> = {
    [profileStorageKey("DAPPS")]: {
      ALL_DAPPS: {
        [ORIGIN]: {
          urlOrigin: ORIGIN,
          accounts: [ACCOUNT],
          blockchains: [{ chainId: DEFAULT_BLOCKCHAIN.chainId }],
          permissions: [],
        },
      },
    },
    [profileStorageKey("ACCOUNTS")]: { ALL_ACCOUNTS: [ACCOUNT] },
    [profileStorageKey("SETTINGS")]: {},
  };
  mockedBrowser.storage.local.get.mockImplementation((key: unknown) =>
    Promise.resolve(
      typeof key === "string" ? { [key]: records[key] } : records,
    ),
  );
};

const buildRequest = (
  method: string,
  params: readonly unknown[],
): JsonRpcRequest => ({
  id: 1,
  jsonrpc: "2.0",
  method,
  params: malformed<JsonRpcRequest["params"]>(params),
  senderData: { url: `${ORIGIN}/app`, tabId: 7 },
});

const buildResponse = (): PendingJsonRpcResponse<Json> => ({
  id: 1,
  jsonrpc: "2.0",
});

const validChain = () => ({
  chainId: "0x2a",
  chainName: "Example",
  rpcUrls: ["https://rpc.example.org"],
  nativeCurrency: { name: "Quanta", symbol: "QRL", decimals: 18 },
  blockExplorerUrls: ["https://explorer.example.org"],
  iconUrls: ["https://icons.example.org/q.png"],
});

const validTypedData = () => ({
  types: { Mail: [{ name: "contents", type: "string" }] },
  primaryType: "Mail",
  domain: { name: "Example", chainId: DEFAULT_BLOCKCHAIN.chainId },
  message: { contents: "hello" },
});

/** Run a request and report whether it was refused before any prompt. */
const run = async (req: JsonRpcRequest) => {
  const res = buildResponse();
  const end = vi.fn();
  const done = restrictedMethodsMiddleware(req, res, vi.fn(), end);
  // A request that reaches the prompt waits on the surface; let the idle
  // timeout settle it so the test can finish.
  await vi.advanceTimersByTimeAsync(POPUP_RESPONSE_TIMEOUT_MS + 1000);
  await done;
  return { res, end };
};

const expectNoPrompt = () => {
  expect(mockOpenApprovalSurface).not.toHaveBeenCalled();
  expect(mockedBrowser.action.openPopup.mock.calls).toHaveLength(0);
  expect(mockedBrowser.windows.create.mock.calls).toHaveLength(0);
  expect(mockedBrowser.storage.session.set.mock.calls).toHaveLength(0);
  // The slot is still free: a fresh claim succeeds.
  expect(claimApprovalSlot({ origin: "https://probe.example" }).claimed).toBe(
    true,
  );
};

beforeEach(() => {
  resetApprovalSlot();
  vi.useFakeTimers();
  mockIsLocked.mockResolvedValue({ isLocked: false, hasPasswordSet: true });
  mockOpenApprovalSurface.mockResolvedValue(undefined);
  setupStorage();
});

afterEach(() => {
  vi.useRealTimers();
  resetApprovalSlot();
});

describe("wallet_addQRLChain refuses what the approval UI cannot render", () => {
  const withField = (field: string, value: unknown) => ({
    ...validChain(),
    [field]: value,
  });
  const withCurrency = (currency: unknown) =>
    withField("nativeCurrency", currency);

  it.each([
    ["iconUrls is a string", withField("iconUrls", "https://i.example/x.png")],
    ["iconUrls holds a number", withField("iconUrls", [1])],
    ["iconUrls is an object", withField("iconUrls", {})],
    ["iconUrls is null", withField("iconUrls", null)],
    ["blockExplorerUrls is a string", withField("blockExplorerUrls", "x")],
    ["blockExplorerUrls holds null", withField("blockExplorerUrls", [null])],
    ["blockExplorerUrls is null", withField("blockExplorerUrls", null)],
    [
      "currency name is a number",
      withCurrency({ name: 5, symbol: "QRL", decimals: 18 }),
    ],
    [
      "currency name is null",
      withCurrency({ name: null, symbol: "QRL", decimals: 18 }),
    ],
  ])("refuses before any prompt: %s", async (_label, chain) => {
    const { res, end } = await run(buildRequest("wallet_addQRLChain", [chain]));
    expect(res.error?.code).toBe(INVALID_PARAMS);
    expect(end).toHaveBeenCalledTimes(1);
    expectNoPrompt();
  });

  it.each([
    ["empty iconUrls", withField("iconUrls", [])],
    ["empty blockExplorerUrls", withField("blockExplorerUrls", [])],
    [
      "both lists empty",
      { ...validChain(), iconUrls: [], blockExplorerUrls: [] },
    ],
    [
      "lists omitted",
      (() => {
        const { chainId, chainName, rpcUrls, nativeCurrency } = validChain();
        return { chainId, chainName, rpcUrls, nativeCurrency };
      })(),
    ],
    ["currency name omitted", withCurrency({ symbol: "QRL", decimals: 18 })],
    [
      "currency name empty string",
      withCurrency({ name: "", symbol: "QRL", decimals: 18 }),
    ],
    ["the full request", validChain()],
  ])("still reaches the prompt: %s", async (_label, chain) => {
    expect(isAddQrlChainParameters(chain)).toBe(true);
    const { res } = await run(buildRequest("wallet_addQRLChain", [chain]));
    expect(res.error?.code).not.toBe(INVALID_PARAMS);
    expect(mockOpenApprovalSurface).toHaveBeenCalledTimes(1);
  });
});

describe("qrl_signTypedData refuses a payload the signer cannot parse", () => {
  const typed = () => validTypedData();
  const without = (key: string) =>
    Object.fromEntries(
      Object.entries(typed()).filter(([name]) => name !== key),
    );

  it.each([
    ["a JSON string", JSON.stringify(typed())],
    ["an extra top-level field", { ...typed(), extra: 1 }],
    ["a null payload", null],
    ["an array payload", [typed()]],
    ["a number payload", 7],
    ["missing types", without("types")],
    ["missing primaryType", without("primaryType")],
    ["missing domain", without("domain")],
    ["missing message", without("message")],
    ["types is an array", { ...typed(), types: [] }],
    ["primaryType is a number", { ...typed(), primaryType: 1 }],
    ["domain is a string", { ...typed(), domain: "x" }],
    ["message is a string", { ...typed(), message: "x" }],
    [
      "a type field with an extra key",
      {
        ...typed(),
        types: { Mail: [{ name: "contents", type: "string", extra: true }] },
      },
    ],
  ])("refuses before any prompt: %s", async (_label, payload) => {
    const { res, end } = await run(
      buildRequest("qrl_signTypedData", [ACCOUNT, payload]),
    );
    expect(res.error?.code).toBe(INVALID_PARAMS);
    expect(end).toHaveBeenCalledTimes(1);
    expectNoPrompt();
  });

  it("refuses a request with no payload slot", async () => {
    const { res } = await run(buildRequest("qrl_signTypedData", [ACCOUNT]));
    expect(res.error?.code).toBe(INVALID_PARAMS);
    expectNoPrompt();
  });

  it("still reaches the prompt for a well-formed object payload", async () => {
    const { res } = await run(
      buildRequest("qrl_signTypedData", [ACCOUNT, typed()]),
    );
    expect(res.error?.code).not.toBe(INVALID_PARAMS);
    expect(mockOpenApprovalSurface).toHaveBeenCalledTimes(1);
  });
});

describe("shared add-chain guard", () => {
  it("is the one the middleware applies", () => {
    expect(isRecord(validChain())).toBe(true);
    expect(isAddQrlChainParameters({ ...validChain(), iconUrls: [1] })).toBe(
      false,
    );
  });
});
