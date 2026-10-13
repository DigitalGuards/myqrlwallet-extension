import type { Page, Worker } from "@playwright/test";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { isUint8Array } from "node:util/types";
import { isRecord } from "../src/utilities/storageGuards";
import { isStringArray, isUnknownArray } from "../src/utilities/approvalGuards";

export const readBody = async (
  request: AsyncIterable<unknown>,
): Promise<string> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
    else if (isUint8Array(chunk)) chunks.push(chunk);
    else throw new Error("Invalid fixture request chunk");
  }
  return Buffer.concat(chunks).toString("utf8");
};

interface RpcRequest {
  id?: string | number | null;
  method: string;
}

const isRpcRequest = (value: unknown): value is RpcRequest =>
  isRecord(value) &&
  typeof value.method === "string" &&
  (value.id === undefined ||
    value.id === null ||
    typeof value.id === "string" ||
    typeof value.id === "number");

export const parseRpcBody = (raw: string): RpcRequest | RpcRequest[] => {
  const body: unknown = JSON.parse(raw);
  if (isRpcRequest(body)) return body;
  if (isUnknownArray(body) && body.every(isRpcRequest)) return body;
  throw new Error("Invalid fixture RPC request");
};

export const readRpcBody = async (request: IncomingMessage) =>
  parseRpcBody(await readBody(request));

export const reportFixtureError = (
  response: ServerResponse,
  error: unknown,
): void => {
  console.error("Fixture request failed:", error);
  response.writeHead(400, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
    }),
  );
};

export const closeFixtureServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

// These callbacks are serialized into the page by Playwright. Their guards
// are self-contained so they also run in the browser's JavaScript context.
export const readWindowValue = (key: string): unknown =>
  Reflect.get(window, key);

export const readProviderProperty = (key: string): unknown => {
  const provider: unknown = Reflect.get(window, "qrlProvider");
  if (
    typeof provider !== "object" ||
    provider === null ||
    Array.isArray(provider)
  )
    return undefined;
  const value: unknown = Reflect.get(provider, key);
  return value;
};

export const hasFixtureProvider = (): boolean => {
  const provider: unknown = Reflect.get(window, "qrlProvider");
  return (
    typeof provider === "object" &&
    provider !== null &&
    !Array.isArray(provider) &&
    "request" in provider &&
    typeof provider.request === "function"
  );
};

interface RequestLocation {
  stateKey: "requestState" | "requestStates" | "trackedRequestStates";
  requestKey?: string;
}

export const readRequestState = ({
  stateKey,
  requestKey,
}: RequestLocation): unknown => {
  const state: unknown = Reflect.get(window, stateKey);
  if (requestKey === undefined) return state;
  if (typeof state !== "object" || state === null || Array.isArray(state))
    return undefined;
  const value: unknown = Reflect.get(state, requestKey);
  return value;
};

export const isRequestDone = ({
  stateKey,
  requestKey,
}: RequestLocation): boolean => {
  let state: unknown = Reflect.get(window, stateKey);
  if (requestKey !== undefined) {
    if (typeof state !== "object" || state === null || Array.isArray(state))
      return false;
    state = Reflect.get(state, requestKey);
  }
  return (
    typeof state === "object" &&
    state !== null &&
    !Array.isArray(state) &&
    "done" in state &&
    state.done === true
  );
};

export const beginFixtureRequest = ({
  stateKey,
  requestKey,
  settlementsKey,
  method,
  params,
  rawError = false,
}: RequestLocation & {
  settlementsKey?: "requestSettlements" | "trackedRequestSettlements";
  method: string;
  params?: DAppRequest["params"];
  rawError?: boolean;
}): void => {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const isProvider = (
    value: unknown,
  ): value is {
    request: (args: DAppRequest) => unknown;
  } => isObject(value) && typeof value.request === "function";
  const hasPromiseMethods = (
    value: unknown,
  ): value is {
    then: (onFulfilled: (result: unknown) => void) => unknown;
    catch: (onRejected: (error: unknown) => void) => unknown;
  } =>
    isObject(value) &&
    typeof value.then === "function" &&
    typeof value.catch === "function";
  const provider: unknown = Reflect.get(window, "qrlProvider");
  if (!isProvider(provider)) throw new Error("Provider unavailable");

  const setState = (state: unknown) => {
    if (requestKey === undefined) {
      Reflect.set(window, stateKey, state);
      return;
    }
    const states: unknown = Reflect.get(window, stateKey);
    if (!isObject(states)) throw new Error("Invalid fixture request states");
    states[requestKey] = state;
  };
  const setSettlements = (initial: boolean) => {
    if (settlementsKey === undefined) return;
    if (requestKey === undefined) {
      const count: unknown = Reflect.get(window, settlementsKey);
      if (!initial && typeof count !== "number")
        throw new Error("Invalid fixture settlement count");
      Reflect.set(window, settlementsKey, initial ? 0 : Number(count) + 1);
      return;
    }
    const counts: unknown = Reflect.get(window, settlementsKey);
    if (!isObject(counts)) throw new Error("Invalid fixture settlement counts");
    const count = counts[requestKey];
    if (!initial && typeof count !== "number")
      throw new Error("Invalid fixture settlement count");
    counts[requestKey] = initial ? 0 : Number(count) + 1;
  };
  setState({ done: false });
  setSettlements(true);
  const result: unknown = provider.request({ method, params });
  if (!hasPromiseMethods(result))
    throw new Error("Provider request did not return a promise");
  const pending = result.then((value) => {
    setSettlements(false);
    setState({ done: true, result: value });
  });
  if (!hasPromiseMethods(pending))
    throw new Error("Provider request did not return a promise");
  pending.catch((error: unknown) => {
    setSettlements(false);
    setState({
      done: true,
      error: rawError
        ? error
        : {
            code:
              isObject(error) && typeof error.code === "number"
                ? error.code
                : undefined,
            message:
              isObject(error) && typeof error.message === "string"
                ? error.message
                : String(error),
          },
    });
  });
};

interface RequestState {
  done: boolean;
  result?: unknown;
  error?: { code?: number; message: string };
}

export const isRequestState = (value: unknown): value is RequestState =>
  isRecord(value) &&
  typeof value.done === "boolean" &&
  (value.error === undefined ||
    (isRecord(value.error) &&
      typeof value.error.message === "string" &&
      (value.error.code === undefined ||
        typeof value.error.code === "number")));

export const fixtureRequestResult = async (
  page: Page,
  location: RequestLocation,
  timeout?: number,
): Promise<unknown> => {
  await page.waitForFunction(isRequestDone, location, { timeout });
  const state = await page.evaluate(readRequestState, location);
  if (!isRequestState(state)) throw new Error("Invalid fixture request state");
  if (state.error)
    throw new Error(
      `RPC ${state.error.code ?? "error"}: ${state.error.message}`,
    );
  return state.result;
};

export const readStorage = async (
  target: Page | Worker,
  area: "local" | "session",
  keys: string[],
): Promise<Record<string, unknown>> => {
  const stored = await target.evaluate(accessStorage, {
    area,
    action: "get" as const,
    value: keys,
  });
  if (!isRecord(stored)) throw new Error("Invalid fixture storage result");
  return stored;
};

// Chrome's ambient namespace includes deprecated Chrome Apps declarations.
// Read the MV3 API as a browser boundary and validate the operation in use.
export const accessStorage = async ({
  area,
  action,
  value,
}: {
  area: "local" | "session";
  action: "get" | "set" | "remove";
  value: string[] | Record<string, unknown>;
}): Promise<unknown> => {
  const isObject = (input: unknown): input is Record<string, unknown> =>
    typeof input === "object" && input !== null && !Array.isArray(input);
  const isOperation = (
    input: unknown,
  ): input is (items: typeof value) => unknown => typeof input === "function";
  const extension: unknown = Reflect.get(globalThis, "chrome");
  if (!isObject(extension) || !isObject(extension.storage))
    throw new Error("Extension storage unavailable");
  const storage = extension.storage[area];
  if (!isObject(storage)) throw new Error("Extension storage area unavailable");
  const operation = storage[action];
  if (!isOperation(operation))
    throw new Error("Extension storage operation unavailable");
  const result = operation.call(storage, value);
  if (!(result instanceof Promise))
    throw new Error("Extension storage operation did not return a promise");
  const pending: Promise<unknown> = result;
  return pending;
};

export const writeStorage = async (
  target: Page | Worker,
  area: "local" | "session",
  value: Record<string, unknown>,
): Promise<void> => {
  await target.evaluate(accessStorage, { area, action: "set" as const, value });
};

export const removeStoredValue = async (
  target: Page | Worker,
  area: "local" | "session",
  key: string,
): Promise<void> => {
  await target.evaluate(accessStorage, {
    area,
    action: "remove" as const,
    value: [key],
  });
};

export const readStoredValue = async (
  target: Page | Worker,
  area: "local" | "session",
  key: string,
): Promise<unknown> => (await readStorage(target, area, [key]))[key];

export interface DAppRequest {
  method: string;
  params?: unknown[] | Record<string, unknown>;
  requestId?: string;
}

export const isDAppRequest = (value: unknown): value is DAppRequest =>
  isRecord(value) &&
  typeof value.method === "string" &&
  (value.params === undefined ||
    isUnknownArray(value.params) ||
    isRecord(value.params)) &&
  (value.requestId === undefined || typeof value.requestId === "string");

export const pendingRequest = (stored: unknown): DAppRequest | undefined => {
  if (stored === undefined || stored === null) return undefined;
  if (!isRecord(stored)) throw new Error("Invalid fixture dApp storage");
  const request = stored.DAPPS_REQUEST_DATA;
  if (request === undefined || request === null) return undefined;
  if (!isDAppRequest(request)) throw new Error("Invalid fixture dApp request");
  return request;
};

export const storedConnection = (
  stored: unknown,
  origin: string,
): Record<string, unknown> | undefined => {
  if (stored === undefined || stored === null) return undefined;
  if (!isRecord(stored)) throw new Error("Invalid fixture dApp storage");
  if (stored.ALL_DAPPS === undefined || stored.ALL_DAPPS === null)
    return undefined;
  if (!isRecord(stored.ALL_DAPPS))
    throw new Error("Invalid fixture dApp connections");
  const connection = stored.ALL_DAPPS[origin];
  if (connection === undefined || connection === null) return undefined;
  if (!isRecord(connection) || !isStringArray(connection.accounts))
    throw new Error("Invalid fixture dApp connection");
  return connection;
};

export const revokeFixtureAccounts = (
  stored: unknown,
  origin: string,
): Record<string, unknown> => {
  const connection = storedConnection(stored, origin);
  if (!isRecord(stored) || !connection)
    throw new Error("Fixture connection unavailable");
  connection.accounts = [];
  return stored;
};

export const fixtureSettings = (stored: unknown): Record<string, unknown> => {
  if (!isRecord(stored)) throw new Error("Invalid fixture settings");
  return stored;
};

export const hasStoredAccount = (
  keystores: unknown,
  accounts: unknown,
  expectedAccount: string,
): boolean => {
  if (
    keystores === undefined ||
    keystores === null ||
    accounts === undefined ||
    accounts === null
  )
    return false;
  if (typeof keystores !== "string" || !isRecord(accounts))
    throw new Error("Invalid fixture account storage");
  const parsed: unknown = JSON.parse(keystores);
  if (
    !isUnknownArray(parsed) ||
    !parsed.every(
      (entry) =>
        isRecord(entry) &&
        (entry.address === undefined ||
          entry.address === null ||
          typeof entry.address === "string"),
    )
  ) {
    throw new Error("Invalid fixture keystores");
  }
  const allAccounts = accounts.ALL_ACCOUNTS;
  if (allAccounts === undefined || allAccounts === null) return false;
  if (!isStringArray(allAccounts)) throw new Error("Invalid fixture accounts");
  const expected = expectedAccount.toLowerCase();
  return (
    parsed.some(
      (entry) =>
        isRecord(entry) &&
        typeof entry.address === "string" &&
        entry.address.toLowerCase() === expected,
    ) && allAccounts.some((account) => account.toLowerCase() === expected)
  );
};

export const hasFixtureAccount = async (
  target: Page | Worker,
  prefix: string,
  account: string,
): Promise<boolean> => {
  const keys = `${prefix}:KEYSTORES`;
  const accounts = `${prefix}:ACCOUNTS`;
  const stored = await readStorage(target, "local", [keys, accounts]);
  return hasStoredAccount(stored[keys], stored[accounts], account);
};

export const readPendingRequest = async (
  target: Page | Worker,
  key: string,
): Promise<DAppRequest | undefined> =>
  pendingRequest(await readStoredValue(target, "session", key));

interface SignProof {
  signature: string;
  publicKey: string;
  descriptor: string;
  signer: string;
  digest: string;
  schemeVersion: string;
}

export const isSignProof = (value: unknown): value is SignProof =>
  isRecord(value) &&
  [
    "signature",
    "publicKey",
    "descriptor",
    "signer",
    "digest",
    "schemeVersion",
  ].every((key) => typeof value[key] === "string");

export interface ProtocolAuth {
  version: "1";
  scheme: "qrl-sign-typed-v1";
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  signature: string;
  publicKey: string;
  descriptor: string;
}

export interface SignedFillIntent {
  intent: {
    orderDigest: string;
    takerEthAccount: string;
    takerQrlAccount: string;
    releaseCommitment: string;
  };
  auth: ProtocolAuth;
}

const isSignedFillIntent = (value: unknown): value is SignedFillIntent => {
  if (!isRecord(value) || !isRecord(value.intent) || !isRecord(value.auth))
    return false;
  const { intent, auth } = value;
  return (
    [
      "orderDigest",
      "takerEthAccount",
      "takerQrlAccount",
      "releaseCommitment",
    ].every((key) => typeof intent[key] === "string") &&
    auth.version === "1" &&
    auth.scheme === "qrl-sign-typed-v1" &&
    typeof auth.issuedAt === "number" &&
    typeof auth.expiresAt === "number" &&
    ["nonce", "signature", "publicKey", "descriptor"].every(
      (key) => typeof auth[key] === "string",
    )
  );
};

export const parseSignedFillIntent = (raw: string): SignedFillIntent => {
  const signed: unknown = JSON.parse(raw);
  if (!isSignedFillIntent(signed))
    throw new Error("Invalid fixture signed fill intent");
  return signed;
};

type HashArguments = [
  domain: Record<string, unknown>,
  types: Record<string, readonly { name: string; type: string }[]>,
  value: Record<string, unknown>,
];

export const fixtureTypedDataEncoder = (library: unknown) => {
  const isEncoder = (
    value: unknown,
  ): value is { hash: (...args: HashArguments) => unknown } =>
    (isRecord(value) || typeof value === "function") &&
    "hash" in value &&
    typeof value.hash === "function";
  if (!isRecord(library) || !isEncoder(library.TypedDataEncoder))
    throw new Error("Fixture typed data encoder unavailable");
  const encoder = library.TypedDataEncoder;
  return {
    hash: (...args: HashArguments): string => {
      const digest = encoder.hash(...args);
      if (typeof digest !== "string")
        throw new Error("Invalid fixture typed data digest");
      return digest;
    },
  };
};

export const installEthereumFixture = ({
  ethAccount,
}: {
  ethAccount: string;
}) => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const provider = {
    request: (args: unknown) => {
      if (
        typeof args !== "object" ||
        args === null ||
        Array.isArray(args) ||
        !("method" in args) ||
        typeof args.method !== "string"
      ) {
        return Promise.reject(new Error("Invalid fixture Ethereum request"));
      }
      const { method } = args;
      if (method === "eth_requestAccounts" || method === "eth_accounts") {
        return Promise.resolve([ethAccount]);
      }
      if (method === "eth_chainId") return Promise.resolve("0xaa36a7");
      if (method === "net_version") return Promise.resolve("11155111");
      return Promise.resolve(null);
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const handlers = listeners.get(event) ?? new Set();
      handlers.add(listener);
      listeners.set(event, handlers);
    },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    },
  };
  const detail = {
    info: {
      uuid: "00000000-0000-4000-8000-000000000001",
      name: "E2E Ethereum Wallet",
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
      rdns: "io.quantawallet.e2e",
    },
    provider,
  };
  const announce = () =>
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", { detail }),
    );
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  return provider;
};
