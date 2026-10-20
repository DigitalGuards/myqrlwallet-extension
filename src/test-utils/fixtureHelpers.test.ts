import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, request } from "node:http";
import { Readable } from "node:stream";
import { runInNewContext } from "node:vm";
import {
  accessStorage,
  beginFixtureRequest,
  closeFixtureServer,
  fixtureSettings,
  fixtureTypedDataEncoder,
  hasFixtureProvider,
  hasStoredAccount,
  installEthereumFixture,
  isRequestDone,
  isRequestState,
  isSignProof,
  parseRpcBody,
  parseSignedFillIntent,
  pendingRequest,
  readBody,
  readProviderProperty,
  readRequestState,
  readRpcBody,
  readWindowValue,
  reportFixtureError,
  revokeFixtureAccounts,
  storedConnection,
} from "../../e2e/fixtureHelpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const key of [
    "qrlProvider",
    "requestState",
    "requestStates",
    "requestSettlements",
    "trackedRequestStates",
    "trackedRequestSettlements",
  ]) {
    Reflect.deleteProperty(window, key);
  }
});

describe("fixture HTTP boundaries", () => {
  it("reads strings and byte chunks without breaking split UTF-8", async () => {
    const bytes = Buffer.from("Quanta €");
    const stream = Readable.from([
      bytes.subarray(0, 8),
      new Uint8Array(bytes.subarray(8)),
      "!",
    ]);
    await expect(readBody(stream)).resolves.toBe("Quanta €!");
    await expect(readBody(Readable.from([{}]))).rejects.toThrow(
      "Invalid fixture request chunk",
    );
  });

  it("preserves single and batched RPC requests, IDs, order and extra fields", () => {
    const first = { id: 0, method: "qrl_chainId", params: [], extra: "keep" };
    const batch = [
      first,
      { id: "next", method: "net_version" },
      { id: null, method: "qrl_accounts" },
      { method: "qrl_blockNumber" },
    ];
    expect(parseRpcBody(JSON.stringify(first))).toEqual(first);
    expect(parseRpcBody(JSON.stringify(batch))).toEqual(batch);
    expect(parseRpcBody("[]")).toEqual([]);
  });

  it.each([
    "null",
    "3",
    '"rpc"',
    "{}",
    '{"method":3}',
    '{"method":"qrl_chainId","id":{}}',
    '[{"method":"qrl_chainId"},null]',
    "{",
  ])("rejects malformed RPC input %s", (raw) => {
    expect(() => parseRpcBody(raw)).toThrow();
  });

  it("reports a rejected HTTP handler and returns a 400 response", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const server = createServer((incoming, response) => {
      readRpcBody(incoming)
        .then(() => {
          response.end("accepted");
        })
        .catch((error: unknown) => {
          reportFixtureError(response, error);
        });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "localhost", resolve);
    });
    try {
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new Error("Fixture did not listen");
      const response = await new Promise<{ status?: number; body: string }>(
        (resolve, reject) => {
          const outgoing = request(
            { hostname: "localhost", port: address.port, method: "POST" },
            (incoming) => {
              readBody(incoming)
                .then((body) => {
                  resolve({ status: incoming.statusCode, body });
                })
                .catch(reject);
            },
          );
          outgoing.on("error", reject);
          outgoing.end('{"method":false}');
        },
      );
      expect(response).toEqual({
        status: 400,
        body: '{"error":"Invalid fixture RPC request"}',
      });
      expect(logged).toHaveBeenCalledWith(
        "Fixture request failed:",
        expect.any(Error),
      );
    } finally {
      await closeFixtureServer(server);
    }
  });

  it("rejects server close errors", async () => {
    await expect(closeFixtureServer(createServer())).rejects.toThrow();
  });
});

describe("fixture browser requests", () => {
  it("keeps Ethereum fixture replies asynchronous and rejects malformed requests", async () => {
    vi.stubGlobal("window", new EventTarget());
    const provider = installEthereumFixture({ ethAccount: "fixture-account" });
    await expect(
      provider.request({ method: "eth_requestAccounts" }),
    ).resolves.toEqual(["fixture-account"]);
    await expect(provider.request({ method: "eth_accounts" })).resolves.toEqual(
      ["fixture-account"],
    );
    await expect(provider.request({ method: "eth_chainId" })).resolves.toBe(
      "0xaa36a7",
    );
    await expect(provider.request({ method: "net_version" })).resolves.toBe(
      "11155111",
    );
    await expect(provider.request({ method: "unknown" })).resolves.toBeNull();
    for (const value of [undefined, null, [], {}, { method: 3 }]) {
      await expect(provider.request(value)).rejects.toThrow(
        "Invalid fixture Ethereum request",
      );
    }
  });

  it("keeps a tracked request pending and records one result and settlement", async () => {
    let finish: (value: unknown) => void = () => {
      throw new Error("Request has not started");
    };
    const pending = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    const request = vi.fn(() => pending);
    const other = { done: true, result: "preserved" };
    Object.assign(window, {
      qrlProvider: { request, chainId: null },
      trackedRequestStates: { other },
      trackedRequestSettlements: { other: 2 },
    });
    const location = {
      stateKey: "trackedRequestStates",
      requestKey: "read",
    } as const;
    beginFixtureRequest({
      ...location,
      settlementsKey: "trackedRequestSettlements",
      method: "qrl_blockNumber",
      params: [],
    });
    expect(request).toHaveBeenCalledWith({
      method: "qrl_blockNumber",
      params: [],
    });
    expect(isRequestDone(location)).toBe(false);
    expect(readRequestState(location)).toEqual({ done: false });
    expect(readProviderProperty("chainId")).toBeNull();
    finish("0x1");
    await vi.waitFor(() => {
      expect(isRequestDone(location)).toBe(true);
    });
    expect(readRequestState(location)).toEqual({ done: true, result: "0x1" });
    expect(readWindowValue("trackedRequestStates")).toEqual({
      other,
      read: { done: true, result: "0x1" },
    });
    expect(readWindowValue("trackedRequestSettlements")).toEqual({
      other: 2,
      read: 1,
    });
  });

  it.each([
    new Error("rejected"),
    { code: 4001, message: "rejected" },
    null,
    "rejected",
  ])("records rejected requests, including primitive errors", async (error) => {
    Object.assign(window, {
      qrlProvider: {
        request: vi.fn<() => Promise<unknown>>().mockRejectedValue(error),
      },
      requestSettlements: 0,
    });
    const location = { stateKey: "requestState" } as const;
    beginFixtureRequest({
      ...location,
      settlementsKey: "requestSettlements",
      method: "qrl_requestAccounts",
    });
    await vi.waitFor(() => {
      expect(isRequestDone(location)).toBe(true);
    });
    const state = readRequestState(location);
    expect(isRequestState(state)).toBe(true);
    expect(state).toEqual({
      done: true,
      error: {
        code:
          error !== null && typeof error === "object" && "code" in error
            ? error.code
            : undefined,
        message: error === null ? "null" : "rejected",
      },
    });
    expect(readWindowValue("requestSettlements")).toBe(1);
  });

  it.each([
    {
      expression: 'Promise.resolve("0x1")',
      state: { done: true, result: "0x1" },
    },
    {
      expression: 'Promise.reject({ code: 4001, message: "rejected" })',
      state: { done: true, error: { code: 4001, message: "rejected" } },
    },
  ])(
    "settles a promise from another realm: $expression",
    async ({ expression, state }) => {
      const result: unknown = runInNewContext(expression);
      expect(result).not.toBeInstanceOf(Promise);
      Object.assign(window, {
        qrlProvider: { request: () => result },
        requestStates: { other: { done: true, result: "keep" } },
        requestSettlements: { other: 2 },
      });
      const location = {
        stateKey: "requestStates",
        requestKey: "foreign",
      } as const;
      beginFixtureRequest({
        ...location,
        settlementsKey: "requestSettlements",
        method: "qrl_blockNumber",
      });
      expect(readRequestState(location)).toEqual({ done: false });
      // The original then/catch chain settles within two microtasks.
      await Promise.resolve();
      await Promise.resolve();
      expect(readRequestState(location)).toEqual(state);
      expect(readWindowValue("requestSettlements")).toEqual({
        other: 2,
        foreign: 1,
      });
      expect(readWindowValue("requestStates")).toEqual({
        other: { done: true, result: "keep" },
        foreign: state,
      });
    },
  );

  it("forwards object parameters unchanged to the provider", async () => {
    const params = { nested: { values: [3, 1] } };
    const request = vi.fn(() => Promise.resolve(["account"]));
    Reflect.set(window, "qrlProvider", { request });
    const location = { stateKey: "requestState" } as const;
    beginFixtureRequest({ ...location, method: "qrl_requestAccounts", params });
    expect(request).toHaveBeenCalledWith({
      method: "qrl_requestAccounts",
      params,
    });
    await Promise.resolve();
    expect(readRequestState(location)).toEqual({
      done: true,
      result: ["account"],
    });
    expect(params).toEqual({ nested: { values: [3, 1] } });
  });

  it("preserves raw rejection values for the calldata fixture", async () => {
    const error = { code: 4001, message: "rejected", data: { reason: "user" } };
    Object.assign(window, {
      qrlProvider: {
        request: vi.fn<() => Promise<unknown>>().mockRejectedValue(error),
      },
    });
    const location = { stateKey: "requestState" } as const;
    beginFixtureRequest({
      ...location,
      method: "qrl_sendTransaction",
      rawError: true,
    });
    await vi.waitFor(() => {
      expect(isRequestDone(location)).toBe(true);
    });
    expect(readRequestState(location)).toEqual({ done: true, error });
  });

  it("requires a callable provider and a promise result", () => {
    expect(hasFixtureProvider()).toBe(false);
    expect(readProviderProperty("chainId")).toBeUndefined();
    expect(() => {
      beginFixtureRequest({ stateKey: "requestState", method: "qrl_chainId" });
    }).toThrow("Provider unavailable");
    for (const result of [
      "0x1",
      null,
      {},
      { then: 1 },
      { then: () => null, catch: () => null },
    ]) {
      Reflect.set(window, "qrlProvider", { request: () => result });
      expect(() => {
        beginFixtureRequest({
          stateKey: "requestState",
          method: "qrl_chainId",
        });
      }).toThrow("did not return a promise");
    }
  });

  it("keeps missing or malformed request states incomplete", () => {
    const location = {
      stateKey: "requestStates",
      requestKey: "missing",
    } as const;
    for (const states of [
      undefined,
      null,
      [],
      {},
      { missing: { done: "true" } },
    ]) {
      Reflect.set(window, "requestStates", states);
      expect(isRequestDone(location)).toBe(false);
    }
    expect(isRequestState({ done: true, error: { message: 4 } })).toBe(false);
    expect(
      isRequestState({ done: true, error: { message: "error", code: "4001" } }),
    ).toBe(false);
  });
});

describe("fixture storage boundaries", () => {
  it("preserves unrelated records and unknown fields during account revocation", () => {
    const origin = "https://dapp.example";
    const other = { accounts: ["other"], extra: [2, 1] };
    const stored = {
      extra: "keep",
      ALL_DAPPS: {
        [origin]: {
          accounts: ["account"],
          permissions: ["sign"],
          extra: [3, 2, 1],
        },
        "https://other.example": other,
      },
    };
    expect(revokeFixtureAccounts(stored, origin)).toBe(stored);
    expect(stored).toEqual({
      extra: "keep",
      ALL_DAPPS: {
        [origin]: { accounts: [], permissions: ["sign"], extra: [3, 2, 1] },
        "https://other.example": other,
      },
    });
  });

  it("rejects malformed connection records before editing them", () => {
    const stored = { ALL_DAPPS: { site: { accounts: [4], extra: "keep" } } };
    expect(() => revokeFixtureAccounts(stored, "site")).toThrow();
    expect(stored.ALL_DAPPS.site).toEqual({ accounts: [4], extra: "keep" });
    expect(storedConnection({}, "missing")).toBeUndefined();
    expect(storedConnection(null, "missing")).toBeUndefined();
    expect(storedConnection({ ALL_DAPPS: null }, "missing")).toBeUndefined();
    expect(
      storedConnection({ ALL_DAPPS: { missing: null } }, "missing"),
    ).toBeUndefined();
    expect(() => storedConnection({ ALL_DAPPS: [] }, "missing")).toThrow();
    expect(() => revokeFixtureAccounts({}, "missing")).toThrow();
  });

  it("preserves settings fields and rejects malformed settings", () => {
    const settings = { currency: "USD", future: { values: [3, 1] } };
    expect({ ...fixtureSettings(settings), currency: "EUR" }).toEqual({
      currency: "EUR",
      future: { values: [3, 1] },
    });
    for (const value of [undefined, null, [], "settings"])
      expect(() => fixtureSettings(value)).toThrow();
  });

  it("allows an absent pending request and rejects malformed wire fields", () => {
    expect(pendingRequest(undefined)).toBeUndefined();
    expect(pendingRequest(null)).toBeUndefined();
    expect(pendingRequest({ DAPPS_REQUEST_DATA: null })).toBeUndefined();
    const request = {
      method: "qrl_sendTransaction",
      params: [{ chainId: "0x301825" }],
      requestId: "request",
      extra: "keep",
    };
    expect(pendingRequest({ DAPPS_REQUEST_DATA: request })).toBe(request);
    for (const data of [
      { method: 1 },
      ...[null, "params", 1, true].map((params) => ({ method: "send", params })),
      { method: "send", requestId: 1 },
    ]) {
      expect(() => pendingRequest({ DAPPS_REQUEST_DATA: data })).toThrow();
    }
  });

  it.each([undefined, [], {}, { nested: { values: [3, 1] }, extra: "keep" }])(
    "preserves pending request parameters and unrelated storage: %j",
    (params) => {
      const request = Object.freeze({
        method: "qrl_requestAccounts",
        params,
        extra: "keep",
      });
      const stored = Object.freeze({
        DAPPS_REQUEST_DATA: request,
        ALL_DAPPS: { other: { accounts: ["account"] } },
        extra: [2, 1],
      });
      const snapshot = structuredClone(stored);
      expect(pendingRequest(stored)).toBe(request);
      expect(pendingRequest(stored)?.params).toBe(params);
      expect(stored).toEqual(snapshot);
    },
  );

  it("checks both account stores while retaining optional legacy address fields", () => {
    const keystores = JSON.stringify([
      { future: "keep" },
      { address: "QaBc", extra: 1 },
    ]);
    const accounts = { ALL_ACCOUNTS: ["other", "QABC"] };
    expect(hasStoredAccount(keystores, accounts, "Qabc")).toBe(true);
    expect(hasStoredAccount(undefined, accounts, "Qabc")).toBe(false);
    expect(hasStoredAccount(null, accounts, "Qabc")).toBe(false);
    expect(hasStoredAccount(keystores, null, "Qabc")).toBe(false);
    expect(hasStoredAccount(keystores, { ALL_ACCOUNTS: null }, "Qabc")).toBe(
      false,
    );
    expect(hasStoredAccount('[{"address":null}]', accounts, "Qabc")).toBe(
      false,
    );
    expect(hasStoredAccount(keystores, { ALL_ACCOUNTS: [] }, "Qabc")).toBe(
      false,
    );
    expect(() =>
      hasStoredAccount('[{"address":3}]', accounts, "Qabc"),
    ).toThrow();
    expect(() =>
      hasStoredAccount(keystores, { ALL_ACCOUNTS: [null] }, "Qabc"),
    ).toThrow();
    expect(() => hasStoredAccount("null", accounts, "Qabc")).toThrow();
  });

  it("calls storage with its receiver and propagates promise failures", async () => {
    const failure = new Error("storage failed");
    const local = {
      get(this: unknown, keys: unknown) {
        expect(this).toBe(local);
        expect(keys).toEqual(["key"]);
        return Promise.resolve({ key: { untouched: [2, 1] } });
      },
      set: () => Promise.reject(failure),
    };
    vi.stubGlobal("chrome", { storage: { local } });
    await expect(
      accessStorage({ area: "local", action: "get", value: ["key"] }),
    ).resolves.toEqual({ key: { untouched: [2, 1] } });
    await expect(
      accessStorage({ area: "local", action: "set", value: { key: 1 } }),
    ).rejects.toBe(failure);
    await expect(
      accessStorage({ area: "session", action: "get", value: [] }),
    ).rejects.toThrow("area unavailable");
    await expect(
      accessStorage({ area: "local", action: "remove", value: [] }),
    ).rejects.toThrow("operation unavailable");
  });
});

describe("fixture signing boundaries", () => {
  it("validates every signing proof field before cryptographic verification", () => {
    const proof = {
      signature: "signature",
      publicKey: "public",
      descriptor: "descriptor",
      signer: "signer",
      digest: "digest",
      schemeVersion: "version",
    };
    expect(isSignProof(proof)).toBe(true);
    for (const key of Object.keys(proof))
      expect(isSignProof({ ...proof, [key]: null })).toBe(false);
  });

  it("preserves valid signed intents and rejects malformed auth or payloads", () => {
    const signed = {
      intent: {
        orderDigest: "digest",
        takerEthAccount: "eth",
        takerQrlAccount: "qrl",
        releaseCommitment: "commitment",
        extra: [2, 1],
      },
      auth: {
        version: "1",
        scheme: "qrl-sign-typed-v1",
        issuedAt: 1,
        expiresAt: 2,
        nonce: "nonce",
        signature: "signature",
        publicKey: "public",
        descriptor: "descriptor",
      },
    };
    expect(parseSignedFillIntent(JSON.stringify(signed))).toEqual(signed);
    for (const invalid of [
      null,
      { ...signed, intent: null },
      { ...signed, auth: { ...signed.auth, version: "2" } },
      { ...signed, auth: { ...signed.auth, expiresAt: "2" } },
      { ...signed, intent: { ...signed.intent, releaseCommitment: [] } },
    ]) {
      expect(() => parseSignedFillIntent(JSON.stringify(invalid))).toThrow();
    }
  });

  it("validates the loaded encoder and its result while preserving its receiver", () => {
    const TypedDataEncoder = {
      hash(this: unknown, ...args: unknown[]) {
        expect(this).toBe(TypedDataEncoder);
        expect(args).toEqual([{}, {}, { field: "value" }]);
        return "digest";
      },
    };
    expect(
      fixtureTypedDataEncoder({ TypedDataEncoder }).hash(
        {},
        {},
        { field: "value" },
      ),
    ).toBe("digest");
    expect(() => fixtureTypedDataEncoder({})).toThrow("unavailable");
    expect(() =>
      fixtureTypedDataEncoder({ TypedDataEncoder: { hash: () => null } }).hash(
        {},
        {},
        {},
      ),
    ).toThrow("Invalid fixture typed data digest");
  });
});
