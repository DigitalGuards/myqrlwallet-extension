import { profileStorageKey } from "@/utilities/profileStorage";
import { isAddQrlChainParameters } from "@/utilities/approvalGuards";
import { malformed } from "@/test-utils/malformed";
import { isRecord } from "@/utilities/storageGuards";
import canonical from "@/functions/pqSigning/__fixtures__/canonical.json";
import { TYPED_DATA_LIMITS } from "@/functions/pqSigning";
import { DEFAULT_BLOCKCHAIN } from "@/configuration/qrlBlockchainConfig";
import type {
  Json,
  JsonRpcRequest,
  PendingJsonRpcResponse,
} from "@theqrl/qrl-wallet-provider/utils";
import { checkWalletAddQrlChainParams } from "../utils/restrictedMethodsMiddlewareUtils";
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

// A payload the signer really signs (pqSigning fixture, v1 scheme); its
// domain chain 3151909 is the wallet's active, authorized chain.
const validTypedData = (): Record<string, unknown> =>
  structuredClone(canonical.schemeSigningVectors[1]?.payload ?? {});

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
  const fixtureTypes = canonical.schemeSigningVectors[1]?.payload.types;
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
      "no QRLDomain type",
      {
        ...typed(),
        types: { Vote: fixtureTypes.Vote },
      },
    ],
    ["primaryType not in types", { ...typed(), primaryType: "Missing" }],
    [
      "an unknown field type",
      {
        ...typed(),
        types: {
          ...fixtureTypes,
          Vote: [{ name: "x", type: "notAType" }],
        },
      },
    ],
    [
      "a limits violation (identifier over the length cap)",
      (() => {
        const long = "A".repeat(TYPED_DATA_LIMITS.maxIdentifierLength + 1);
        return {
          ...typed(),
          primaryType: long,
          types: {
            QRLDomain: fixtureTypes.QRLDomain,
            [long]: fixtureTypes.Vote,
          },
        };
      })(),
    ],
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

describe("qrl_signMessage refuses a message the signer cannot take", () => {
  it.each([
    ["an object", { foo: 1 }],
    ["a number", 42],
    ["null", null],
    ["an array", ["0x00"]],
    ["a plain string", "hello"],
    ["hex without the prefix", "48656c6c6f"],
    ["odd-length hex", "0x123"],
    ["non-hex characters", "0xzz"],
  ])("refuses before any prompt: %s", async (_label, message) => {
    const { res, end } = await run(
      buildRequest("qrl_signMessage", [ACCOUNT, message]),
    );
    expect(res.error?.code).toBe(INVALID_PARAMS);
    expect(end).toHaveBeenCalledTimes(1);
    expectNoPrompt();
  });

  it("refuses a request with no message slot", async () => {
    const { res } = await run(buildRequest("qrl_signMessage", [ACCOUNT]));
    expect(res.error?.code).toBe(INVALID_PARAMS);
    expectNoPrompt();
  });

  it.each(["0x", "0x48656c6c6f"])(
    "still reaches the prompt for %s",
    async (message) => {
      const { res } = await run(
        buildRequest("qrl_signMessage", [ACCOUNT, message]),
      );
      expect(res.error?.code).not.toBe(INVALID_PARAMS);
      expect(mockOpenApprovalSurface).toHaveBeenCalledTimes(1);
    },
  );
});

describe("add-chain guard through checkWalletAddQrlChainParams", () => {
  it("refuses what the UI guard refuses and accepts what it accepts", async () => {
    const refused = await checkWalletAddQrlChainParams({
      ...validChain(),
      iconUrls: [1],
    });
    expect(refused.canProceed).toBe(false);
    const accepted = await checkWalletAddQrlChainParams(validChain());
    expect(accepted.canProceed).toBe(true);
  });
});

describe("authorization is answered before the payload is looked at", () => {
  const OTHER_ACCOUNT = toChecksumAddress(`Q${"b".repeat(128)}`);
  const goodMessage = "0x48656c6c6f";
  const badMessage = { foo: 1 };
  const goodTyped = (): Record<string, unknown> => validTypedData();
  const badTyped = (): Record<string, unknown> => ({
    ...validTypedData(),
    extra: 1,
  });

  const fromOrigin = (req: JsonRpcRequest, origin: string): JsonRpcRequest => ({
    ...req,
    senderData: { url: `${origin}/app`, tabId: 7 },
  });

  type Scenario = {
    label: string;
    prepare?: () => void;
    build: (method: string, payload: unknown) => JsonRpcRequest;
    methods: string[];
  };
  const both = ["qrl_signTypedData", "qrl_signMessage"];
  const scenarios: Scenario[] = [
    {
      label: "a locked wallet",
      prepare: () => {
        mockIsLocked.mockResolvedValue({
          isLocked: true,
          hasPasswordSet: true,
        });
      },
      build: (method, payload) => buildRequest(method, [ACCOUNT, payload]),
      methods: both,
    },
    {
      label: "an unconnected origin",
      build: (method, payload) =>
        fromOrigin(
          buildRequest(method, [ACCOUNT, payload]),
          "https://unconnected.example",
        ),
      methods: both,
    },
    {
      label: "an unauthorized account",
      build: (method, payload) =>
        buildRequest(method, [OTHER_ACCOUNT, payload]),
      methods: both,
    },
    {
      label: "a chain mismatch",
      build: (method, payload) =>
        buildRequest(method, [
          ACCOUNT,
          isRecord(payload)
            ? { ...payload, domain: { name: "x", chainId: "0x999" } }
            : payload,
        ]),
      methods: ["qrl_signTypedData"],
    },
  ];

  for (const scenario of scenarios) {
    for (const method of scenario.methods) {
      it(`${method} from ${scenario.label}: a bad payload gets the refusal a good one gets`, async () => {
        scenario.prepare?.();
        const typedMethod = method === "qrl_signTypedData";
        const good = await run(
          scenario.build(method, typedMethod ? goodTyped() : goodMessage),
        );
        const bad = await run(
          scenario.build(method, typedMethod ? badTyped() : badMessage),
        );
        expect(good.res.error).toBeDefined();
        expect(good.res.error?.code).not.toBe(INVALID_PARAMS);
        expect(bad.res.error).toEqual(good.res.error);
        expect(mockOpenApprovalSurface).not.toHaveBeenCalled();
      });
    }
  }
});

/**
 * A send request names the chain's one transaction type or none, and its
 * call data once. Ported from theQRL/qrl-web3-wallet #39: a contract call
 * made with the library names its call data `input` and sends no `data`,
 * and the approval reads `data` only.
 */
describe("qrl_sendTransaction: the type and the call data are settled before the prompt", () => {
  const RECIPIENT = toChecksumAddress(`Q${"b".repeat(128)}`);
  const OTHER_ACCOUNT = toChecksumAddress(`Q${"c".repeat(128)}`);
  const CALL = `0xa9059cbb${"00".repeat(31)}ff`;
  const transfer = (fields: Record<string, unknown> = {}) => ({
    from: ACCOUNT,
    to: RECIPIENT,
    value: "0x1",
    gas: "0x5208",
    ...fields,
  });
  const contractCall = (fields: Record<string, unknown> = {}) => ({
    from: ACCOUNT,
    to: RECIPIENT,
    gas: "0x186a0",
    ...fields,
  });
  const send = (params: readonly unknown[]) =>
    run(buildRequest("qrl_sendTransaction", params));

  /** The params of the request as the service worker stored it for the approval. */
  const storedParams = (): unknown => {
    const key = profileStorageKey("DAPPS");
    for (const [values] of mockedBrowser.storage.session.set.mock.calls) {
      const dapps: unknown = isRecord(values) ? values[key] : undefined;
      const request: unknown = isRecord(dapps)
        ? dapps.DAPPS_REQUEST_DATA
        : undefined;
      if (isRecord(request) && request.method === "qrl_sendTransaction") {
        return request.params;
      }
    }
    throw new Error("No send request was stored for the approval");
  };

  it.each([
    ["0x0", '"0x0"'],
    ["0x1", '"0x1"'],
    ["0x3", '"0x3"'],
    ["2", '"2"'],
    [0, "0"],
    [1, "1"],
    [true, "true"],
  ])("refuses the type %j before any prompt", async (type, named) => {
    const { res, end } = await send([transfer({ type })]);
    expect(res.error?.code).toBe(INVALID_PARAMS);
    expect(res.error?.message).toBe(
      `QRL transactions are of type 0x2. Received type: ${named}`,
    );
    expect(end).toHaveBeenCalledTimes(1);
    expectNoPrompt();
  });

  it.each([
    ["no type", {}],
    ["a null type", { type: null }],
    ['"0x2"', { type: "0x2" }],
    ['"0x02"', { type: "0x02" }],
    ['"0X2"', { type: "0X2" }],
    ["the number 2", { type: 2 }],
    ["no type and a gas price", { gasPrice: "0x3b9aca00" }],
  ])("still reaches the prompt with %s", async (_label, fields) => {
    const { res } = await send([transfer(fields)]);
    expect(res.error?.code).not.toBe(INVALID_PARAMS);
    expect(mockOpenApprovalSurface).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "other bytes",
      { data: "0x01", input: CALL },
      '"data" and "input" are both set and differ',
    ],
    [
      "an empty data beside an input",
      { data: "0x", input: CALL },
      '"data" and "input" are both set and differ',
    ],
    [
      "a data that is no text",
      { data: 1, input: CALL },
      '"data" and "input" are both set and differ',
    ],
    [
      "an input that is no text",
      { input: 1 },
      '"input" has to be a hex string',
    ],
    [
      "an input that is a list",
      { input: [CALL] },
      '"input" has to be a hex string',
    ],
  ])(
    "refuses call data named twice before any prompt: %s",
    async (_label, fields, message) => {
      const { res, end } = await send([contractCall(fields)]);
      expect(res.error?.code).toBe(INVALID_PARAMS);
      expect(res.error?.message).toBe(message);
      expect(end).toHaveBeenCalledTimes(1);
      expectNoPrompt();
    },
  );

  it("stores a contract call whose call data came as input with it as data, and without input", async () => {
    // What contract.methods.x().send() of the library hands over: `input`,
    // no `data`, no `type`.
    await send([contractCall({ input: CALL })]);
    expect(mockOpenApprovalSurface).toHaveBeenCalledTimes(1);
    expect(storedParams()).toEqual([contractCall({ data: CALL })]);
  });

  it("stores a payable call whose call data came as input as a call: read as it came it would be a plain transfer", async () => {
    await send([transfer({ input: CALL })]);
    expect(storedParams()).toEqual([transfer({ data: CALL })]);
  });

  it.each([
    [
      "data and input with the same bytes",
      contractCall({
        data: CALL.toUpperCase().replace("0X", "0x"),
        input: CALL,
      }),
      contractCall({ data: CALL.toUpperCase().replace("0X", "0x") }),
    ],
    ["data only", contractCall({ data: CALL }), contractCall({ data: CALL })],
    ["no call data", transfer(), transfer()],
    ["an input that names nothing", transfer({ input: null }), transfer()],
    [
      "a null data beside an input",
      contractCall({ data: null, input: CALL }),
      contractCall({ data: CALL }),
    ],
  ])("stores %s as the approval reads it", async (_label, sent, stored) => {
    await send([sent]);
    expect(storedParams()).toEqual([stored]);
  });

  it("keeps whatever follows the transaction in the params", async () => {
    await send([contractCall({ input: CALL }), "latest"]);
    expect(storedParams()).toEqual([contractCall({ data: CALL }), "latest"]);
  });

  it("reads the transaction from indexed params the way the approval does", async () => {
    const indexed: Record<string, Json> = {
      0: { from: ACCOUNT, to: RECIPIENT, gas: "0x186a0", input: CALL },
    };
    await run({ ...buildRequest("qrl_sendTransaction", []), params: indexed });
    expect(storedParams()).toEqual({ 0: contractCall({ data: CALL }) });
  });

  it("lets a contract creation with an amount through when its code came as input", async () => {
    // Read as it came, this request has no recipient and no data, and was
    // refused as a contract without code that could only burn the amount.
    const creation = { from: ACCOUNT, value: "0x1", gas: "0x186a0" };
    const { res } = await send([{ ...creation, input: "0x60806040" }]);
    expect(res.error?.code).not.toBe(INVALID_PARAMS);
    expect(storedParams()).toEqual([{ ...creation, data: "0x60806040" }]);
  });

  it("still refuses a contract creation with an amount and no code under either name", async () => {
    const { res } = await send([
      { from: ACCOUNT, value: "0x1", gas: "0x186a0" },
    ]);
    expect(res.error?.code).toBe(INVALID_PARAMS);
    expect(res.error?.message).toContain("creates a contract with no code");
    expectNoPrompt();
  });

  describe("authorization is answered before the transaction is looked at", () => {
    const bad = [
      ["another type", transfer({ type: "0x0" })],
      ["call data named twice", contractCall({ data: "0x01", input: CALL })],
    ] as const;
    const scenarios = [
      {
        label: "a locked wallet",
        prepare: () => {
          mockIsLocked.mockResolvedValue({
            isLocked: true,
            hasPasswordSet: true,
          });
        },
        from: (transaction: Record<string, unknown>) => send([transaction]),
      },
      {
        label: "an unconnected origin",
        prepare: () => undefined,
        from: (transaction: Record<string, unknown>) =>
          run({
            ...buildRequest("qrl_sendTransaction", [transaction]),
            senderData: { url: "https://unconnected.example/app", tabId: 7 },
          }),
      },
      {
        label: "an unauthorized account",
        prepare: () => undefined,
        from: (transaction: Record<string, unknown>) =>
          send([{ ...transaction, from: OTHER_ACCOUNT }]),
      },
    ];

    for (const scenario of scenarios) {
      it.each(bad)(
        `from ${scenario.label}, %s gets the refusal a good transfer gets`,
        async (_label, transaction) => {
          scenario.prepare();
          const good = await scenario.from(transfer());
          const refused = await scenario.from(transaction);
          expect(good.res.error).toBeDefined();
          expect(good.res.error?.code).not.toBe(INVALID_PARAMS);
          expect(refused.res.error).toEqual(good.res.error);
          expect(mockOpenApprovalSurface).not.toHaveBeenCalled();
        },
      );
    }
  });
});
