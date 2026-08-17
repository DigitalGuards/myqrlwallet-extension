import { expect, test, chromium, type Page } from "@playwright/test";
import { shake256 } from "@noble/hashes/sha3.js";
import { cryptoSignVerify } from "@theqrl/mldsa87";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
} from "../src/functions/pqSigning/bytes";
import {
  SCHEME_TAG_TYPED,
  SCHEME_VERSION_TYPED,
} from "../src/functions/pqSigning/ctx";
import {
  computeTypedDataDigest,
  type TypedDataPayload,
} from "../src/functions/pqSigning/typedData";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const EXTENSION_PATH = path.join(REPO_ROOT, "Extension");

// Public deterministic fixture from canonical.json. Never fund this account.
const TEST_ONLY_HEX_SEED =
  "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";
const CHECKSUM_ACCOUNT = "Q6afB7Dfc849bC16E439033dfee7B296484619Db8";
const CANONICAL_ACCOUNT = `Q${CHECKSUM_ACCOUNT.slice(1).toLowerCase()}`;

const FILL_INTENT_V1_FIELDS = [
  { name: "orderDigest", type: "bytes32" },
  { name: "requestNonce", type: "bytes32" },
  { name: "takerEthAccount", type: "string" },
  { name: "takerQrlAccount", type: "string" },
  { name: "releaseCommitment", type: "bytes32" },
  { name: "issuedAt", type: "uint64" },
  { name: "expiresAt", type: "uint64" },
  { name: "ethChainId", type: "uint256" },
  { name: "ethHtlc", type: "string" },
  { name: "qrlChainId", type: "uint256" },
  { name: "qrlHtlc", type: "string" },
] as const;

const fillIntentPayload: TypedDataPayload = {
  types: {
    QRLDomain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "salt", type: "bytes32" },
    ],
    FillIntentV1: [...FILL_INTENT_V1_FIELDS],
  },
  primaryType: "FillIntentV1",
  domain: {
    name: "QuantaSwap",
    version: "1",
    chainId: "1337",
    salt: "0x1ed0597b5e221ddfd0e541d33a5c14d663f5261645be67c4ee3a4be4d804a740",
  },
  message: {
    orderDigest:
      "0x5a76e96bdd26891fc5b28848ed2f519a9fee5d8bdc7614692b71a3431c085a48",
    requestNonce: `0x${"43".repeat(32)}`,
    takerEthAccount:
      "eip155:11155111:0x2222222222222222222222222222222222222222",
    takerQrlAccount: CANONICAL_ACCOUNT,
    releaseCommitment:
      "0xa786c492a3707147bfa3277ddf44d49af0c794252e42dd05379f04b8c4621e0e",
    issuedAt: "1800000010",
    expiresAt: "1800000130",
    ethChainId: "11155111",
    ethHtlc: "eip155:11155111:0x910d5d4a7f2037c01f3b4c835167357e89909281",
    qrlChainId: "1337",
    qrlHtlc: "Q238322ad2e8f935b4481fcc379779c31b84decb0",
  },
};

interface QrlProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: "accountsChanged", listener: (accounts: string[]) => void): void;
  chainId: string | null;
  selectedAddress: string | null;
}

interface DAppRequestState {
  done: boolean;
  result?: unknown;
  error?: { code?: number; message: string };
}

interface DAppWindow extends Window {
  qrlProvider?: QrlProvider;
  accountEvents: string[][];
  requestState?: DAppRequestState;
  requestSettlements: number;
  trackedRequestStates: Record<string, DAppRequestState>;
  trackedRequestSettlements: Record<string, number>;
}

interface SignProof {
  signature: string;
  publicKey: string;
  descriptor: string;
  signer: string;
  digest: string;
  schemeVersion: string;
}

const dAppHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>QuantaSwap lifecycle fixture</title></head>
  <body>
    <h1>QuantaSwap lifecycle fixture</h1>
    <script>
      window.accountEvents = [];
      window.requestSettlements = 0;
      window.trackedRequestStates = {};
      window.trackedRequestSettlements = {};
      window.addEventListener("eip6963:announceProvider", (event) => {
        if (event.detail.info.rdns !== "com.qrlwallet.extension") return;
        window.qrlProvider = event.detail.provider;
        window.qrlProvider.on("accountsChanged", (accounts) => {
          window.accountEvents.push([...accounts]);
        });
      });
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    </script>
  </body>
</html>`;

const rpcResult = (method: string): unknown => {
  switch (method) {
    case "qrl_chainId":
      return "0x539";
    case "net_version":
      return "1337";
    case "net_listening":
      return true;
    case "qrl_getBalance":
      return "0x0";
    case "qrl_blockNumber":
      return "0x1";
    case "web3_clientVersion":
      return "myqrlwallet-e2e";
    default:
      return "0x0";
  }
};

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const handleRpc = async (
  request: IncomingMessage,
  response: ServerResponse,
  methods: string[],
  waitForHeldRpc: (methods: string[]) => Promise<void>,
) => {
  const body = JSON.parse(await readBody(request)) as
    | { id?: string | number; method: string }
    | Array<{ id?: string | number; method: string }>;
  const requests = Array.isArray(body) ? body : [body];
  methods.push(...requests.map(({ method }) => method));
  await waitForHeldRpc(requests.map(({ method }) => method));
  response.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  });
  const results = requests.map(({ id, method }) => ({
    jsonrpc: "2.0",
    id: id ?? null,
    result: rpcResult(method),
  }));
  response.end(JSON.stringify(Array.isArray(body) ? results : results[0]));
};

const startFixtureServer = async () => {
  const rpcMethods: string[] = [];
  const heldRpcMethods = new Set<string>();
  let heldRpcResolvers: Array<() => void> = [];
  const waitForHeldRpc = async (methods: string[]) => {
    if (!methods.some((method) => heldRpcMethods.has(method))) return;
    await new Promise<void>((resolve) => heldRpcResolvers.push(resolve));
  };
  const releaseHeldRpc = () => {
    heldRpcMethods.clear();
    const resolvers = heldRpcResolvers;
    heldRpcResolvers = [];
    resolvers.forEach((resolve) => resolve());
  };
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/rpc") {
      void handleRpc(request, response, rpcMethods, waitForHeldRpc);
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(dAppHtml);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture server did not bind TCP");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    rpcMethods,
    holdRpc: (method: string) => {
      heldRpcMethods.add(method);
    },
    releaseHeldRpc,
    close: () => {
      releaseHeldRpc();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

const waitForProvider = async (page: Page) => {
  await page.waitForFunction(() =>
    Boolean((window as unknown as DAppWindow).qrlProvider),
  );
};

const beginRequest = async (page: Page, method: string, params?: unknown[]) => {
  await page.evaluate(
    ({ requestMethod, requestParams }) => {
      const dApp = window as unknown as DAppWindow;
      if (!dApp.qrlProvider) throw new Error("Provider unavailable");
      dApp.requestState = { done: false };
      dApp.requestSettlements = 0;
      void dApp.qrlProvider
        .request({ method: requestMethod, params: requestParams })
        .then((result) => {
          dApp.requestSettlements += 1;
          dApp.requestState = { done: true, result };
        })
        .catch((error: unknown) => {
          dApp.requestSettlements += 1;
          const rpcError = error as { code?: number; message?: string };
          dApp.requestState = {
            done: true,
            error: {
              code: rpcError.code,
              message: rpcError.message ?? String(error),
            },
          };
        });
    },
    { requestMethod: method, requestParams: params },
  );
};

const requestResult = async <T>(page: Page): Promise<T> => {
  await page.waitForFunction(
    () => (window as unknown as DAppWindow).requestState?.done === true,
  );
  const state = await page.evaluate(
    () => (window as unknown as DAppWindow).requestState as DAppRequestState,
  );
  if (state.error)
    throw new Error(
      `RPC ${state.error.code ?? "error"}: ${state.error.message}`,
    );
  return state.result as T;
};

const beginTrackedRequest = async (
  page: Page,
  key: string,
  method: string,
  params?: unknown[],
) => {
  await page.evaluate(
    ({ requestKey, requestMethod, requestParams }) => {
      const dApp = window as unknown as DAppWindow;
      if (!dApp.qrlProvider) throw new Error("Provider unavailable");
      dApp.trackedRequestStates[requestKey] = { done: false };
      dApp.trackedRequestSettlements[requestKey] = 0;
      void dApp.qrlProvider
        .request({ method: requestMethod, params: requestParams })
        .then((result) => {
          dApp.trackedRequestSettlements[requestKey] += 1;
          dApp.trackedRequestStates[requestKey] = { done: true, result };
        })
        .catch((error: unknown) => {
          dApp.trackedRequestSettlements[requestKey] += 1;
          const rpcError = error as { code?: number; message?: string };
          dApp.trackedRequestStates[requestKey] = {
            done: true,
            error: {
              code: rpcError.code,
              message: rpcError.message ?? String(error),
            },
          };
        });
    },
    { requestKey: key, requestMethod: method, requestParams: params },
  );
};

const trackedRequestResult = async <T>(page: Page, key: string): Promise<T> => {
  await page.waitForFunction(
    (requestKey) =>
      (window as unknown as DAppWindow).trackedRequestStates[requestKey]
        ?.done === true,
    key,
  );
  const state = await page.evaluate(
    (requestKey) =>
      (window as unknown as DAppWindow).trackedRequestStates[requestKey],
    key,
  );
  if (state.error)
    throw new Error(
      `RPC ${state.error.code ?? "error"}: ${state.error.message}`,
    );
  return state.result as T;
};

const approveCurrentRequest = async (extensionPage: Page) => {
  const yes = extensionPage.getByRole("button", { name: "Yes" });
  await expect(yes).toBeEnabled();
  await yes.click();
};

test("QuantaSwap connect, lowercase PQ sign, disconnect, and reconnect", async () => {
  const fixture = await startFixtureServer();
  const profile = await mkdtemp(path.join(tmpdir(), "myqrlwallet-e2e-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    ],
  });
  const providerLifecycleErrors: string[] = [];
  context.on("console", (message) => {
    const text = message.text();
    if (
      text.includes("StreamMiddleware - Unknown response id") ||
      text.includes("Provider already initialized") ||
      text.includes("Failed to get initial state")
    ) {
      providerLifecycleErrors.push(text);
    }
  });

  try {
    const serviceWorker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(serviceWorker.url()).host;
    await serviceWorker.evaluate(
      async ({ rpcUrl }) => {
        await chrome.storage.local.set({
          SETTINGS: {
            sidePanelPreferred: true,
            phishingDetectionEnabled: false,
            autoLockMinutes: 30,
          },
          BLOCKCHAINS: {
            ACTIVE_BLOCKCHAIN: "0x539",
            ALL_BLOCKCHAINS: [
              {
                chainId: "0x539",
                chainName: "QRL E2E Testnet",
                rpcUrls: [rpcUrl],
                blockExplorerUrls: ["https://example.invalid"],
                nativeCurrency: {
                  name: "Quanta",
                  symbol: "Quanta",
                  decimals: 18,
                },
                iconUrls: [],
                defaultRpcUrl: rpcUrl,
                defaultBlockExplorerUrl: "https://example.invalid",
                defaultIconUrl: "",
                isTestnet: true,
                defaultWsRpcUrl: rpcUrl,
                isCustomChain: true,
              },
            ],
          },
        });
      },
      { rpcUrl: `${fixture.origin}/rpc` },
    );

    let extensionPage = await context.newPage();
    await extensionPage.goto(
      `chrome-extension://${extensionId}/index.html?tab=true`,
    );
    await extensionPage.getByRole("button", { name: "Continue" }).click();
    await extensionPage
      .getByLabel("password", { exact: true })
      .fill("e2e-password-only");
    await extensionPage
      .getByLabel("reEnteredPassword")
      .fill("e2e-password-only");
    await extensionPage.getByRole("button", { name: "Continue" }).click();
    await extensionPage
      .getByRole("button", { name: "Import an existing account" })
      .click();
    await extensionPage.getByRole("tab", { name: "Hex seed" }).click();
    await extensionPage
      .getByRole("textbox", { name: "hexSeed" })
      .fill(TEST_ONLY_HEX_SEED);
    await extensionPage.getByRole("button", { name: "Import account" }).click();
    await extensionPage.getByRole("button", { name: "Continue" }).click();
    await expect(
      extensionPage.getByRole("heading", { name: "That's All" }),
    ).toBeVisible();
    const onboardingClosed = extensionPage.waitForEvent("close");
    await extensionPage.getByRole("button", { name: "Done" }).click();
    await onboardingClosed;
    await expect
      .poll(
        () =>
          serviceWorker.evaluate(async (expectedAccount) => {
            const { KEYSTORES, ACCOUNTS } = await chrome.storage.local.get([
              "KEYSTORES",
              "ACCOUNTS",
            ]);
            const keystores = JSON.parse(KEYSTORES ?? "[]") as Array<{
              address?: string;
            }>;
            const normalizedExpected = expectedAccount.toLowerCase();
            return (
              keystores.some(
                ({ address }) => address?.toLowerCase() === normalizedExpected,
              ) &&
              ACCOUNTS?.ALL_ACCOUNTS?.some(
                (account: string) =>
                  account.toLowerCase() === normalizedExpected,
              )
            );
          }, CHECKSUM_ACCOUNT),
        { timeout: 60_000 },
      )
      .toBe(true);
    extensionPage = await context.newPage();
    await extensionPage.goto(
      `chrome-extension://${extensionId}/index.html?tab=true`,
    );
    await expect(
      extensionPage.getByRole("heading", { name: "Active account" }),
    ).toBeVisible();

    const dAppPage = await context.newPage();
    await dAppPage.goto(fixture.origin);
    await dAppPage.bringToFront();
    await waitForProvider(dAppPage);
    await expect
      .poll(() =>
        dAppPage.evaluate(
          () => (window as unknown as DAppWindow).qrlProvider?.chainId ?? null,
        ),
      )
      .toBe("0x539");
    expect(fixture.rpcMethods).toContain("qrl_chainId");

    const blockCallsBeforeRestart = fixture.rpcMethods.filter(
      (method) => method === "qrl_blockNumber",
    ).length;
    const clientVersionCallsBeforeRestart = fixture.rpcMethods.filter(
      (method) => method === "web3_clientVersion",
    ).length;
    fixture.holdRpc("qrl_blockNumber");
    fixture.holdRpc("web3_clientVersion");
    await beginTrackedRequest(dAppPage, "interrupted", "qrl_blockNumber");
    await expect
      .poll(
        () =>
          fixture.rpcMethods.filter((method) => method === "qrl_blockNumber")
            .length,
      )
      .toBe(blockCallsBeforeRestart + 1);

    const workerUrl = serviceWorker.url();
    const cdp = await context.newCDPSession(dAppPage);
    const { targetInfos } = await cdp.send("Target.getTargets");
    const workerTarget = targetInfos.find(
      ({ type, url }) => type === "service_worker" && url === workerUrl,
    );
    expect(workerTarget).toBeDefined();
    const closedTarget = await cdp.send("Target.closeTarget", {
      targetId: workerTarget?.targetId ?? "",
    });
    expect(closedTarget.success).toBe(true);
    await expect
      .poll(
        async () =>
          (await cdp.send("Target.getTargets")).targetInfos.some(
            ({ targetId }) => targetId === workerTarget?.targetId,
          ),
        { timeout: 15_000 },
      )
      .toBe(false);
    await beginTrackedRequest(
      dAppPage,
      "during-reconnect",
      "web3_clientVersion",
    );

    await expect
      .poll(
        () =>
          fixture.rpcMethods.filter((method) => method === "qrl_blockNumber")
            .length,
        { timeout: 15_000 },
      )
      .toBe(blockCallsBeforeRestart + 2);
    await expect
      .poll(
        () =>
          fixture.rpcMethods.filter((method) => method === "web3_clientVersion")
            .length,
        { timeout: 15_000 },
      )
      .toBe(clientVersionCallsBeforeRestart + 1);
    await cdp.detach();
    fixture.releaseHeldRpc();
    await expect(
      Promise.all([
        trackedRequestResult<string>(dAppPage, "interrupted"),
        trackedRequestResult<string>(dAppPage, "during-reconnect"),
      ]),
    ).resolves.toEqual(["0x1", "myqrlwallet-e2e"]);
    await dAppPage.waitForTimeout(100);
    expect(
      await dAppPage.evaluate(
        () => (window as unknown as DAppWindow).trackedRequestSettlements,
      ),
    ).toMatchObject({ interrupted: 1, "during-reconnect": 1 });
    await dAppPage.waitForTimeout(500);
    expect(
      fixture.rpcMethods.filter((method) => method === "qrl_blockNumber")
        .length,
    ).toBe(blockCallsBeforeRestart + 2);
    expect(
      fixture.rpcMethods.filter((method) => method === "web3_clientVersion")
        .length,
    ).toBe(clientVersionCallsBeforeRestart + 1);

    await beginRequest(dAppPage, "qrl_requestAccounts");
    await dAppPage.waitForTimeout(500);
    const earlyRequestState = await dAppPage.evaluate(
      () => (window as unknown as DAppWindow).requestState,
    );
    if (earlyRequestState?.error) {
      throw new Error(
        `qrl_requestAccounts failed before approval: ${JSON.stringify(earlyRequestState.error)}`,
      );
    }
    await expect
      .poll(() =>
        extensionPage.evaluate(
          async () =>
            (await chrome.storage.session.get("DAPPS")).DAPPS
              ?.DAPPS_REQUEST_DATA?.method ?? null,
        ),
      )
      .toBe("qrl_requestAccounts");
    await approveCurrentRequest(extensionPage);
    await expect(requestResult<string[]>(dAppPage)).resolves.toEqual([
      CHECKSUM_ACCOUNT,
    ]);

    const storedConnection = await extensionPage.evaluate(
      async (origin) =>
        (await chrome.storage.local.get("DAPPS")).DAPPS?.ALL_DAPPS?.[origin],
      fixture.origin,
    );
    expect(storedConnection?.accounts).toEqual([CHECKSUM_ACCOUNT]);
    const chainIdCallsBeforeReload = fixture.rpcMethods.filter(
      (method) => method === "qrl_chainId",
    ).length;
    expect(chainIdCallsBeforeReload).toBe(1);

    await dAppPage.reload();
    await waitForProvider(dAppPage);
    await expect
      .poll(() =>
        dAppPage.evaluate(
          () => (window as unknown as DAppWindow).qrlProvider?.selectedAddress,
        ),
      )
      .toBe(CHECKSUM_ACCOUNT);
    await expect
      .poll(
        () =>
          fixture.rpcMethods.filter((method) => method === "qrl_chainId")
            .length,
      )
      .toBe(chainIdCallsBeforeReload + 1);

    await beginRequest(dAppPage, "qrl_signTypedData", [
      CANONICAL_ACCOUNT,
      fillIntentPayload,
    ]);
    await approveCurrentRequest(extensionPage);
    const proof = await requestResult<SignProof>(dAppPage);
    const digest = computeTypedDataDigest(fillIntentPayload);
    expect(proof.schemeVersion).toBe(SCHEME_VERSION_TYPED);
    expect(proof.digest).toBe(bytesToHex(digest));
    expect(`Q${proof.signer.slice(1).toLowerCase()}`).toBe(CANONICAL_ACCOUNT);
    expect(
      cryptoSignVerify(
        hexToBytes(proof.signature),
        digest,
        hexToBytes(proof.publicKey),
        SCHEME_TAG_TYPED,
      ),
    ).toBe(true);
    const signerHash = shake256(
      concatBytes(hexToBytes(proof.descriptor), hexToBytes(proof.publicKey)),
      { dkLen: 20 },
    );
    expect(`Q${bytesToHex(signerHash).slice(2)}`).toBe(CANONICAL_ACCOUNT);

    await dAppPage.bringToFront();
    await extensionPage.locator('a[href="/dapp-connectivity"] button').click();
    await expect(
      extensionPage.getByText(fixture.origin, { exact: true }),
    ).toBeVisible();
    await expect(
      extensionPage.getByText(
        "The following accounts are connected, and can interact with this website.",
      ),
    ).toBeVisible();
    await extensionPage.getByRole("button", { name: "Disconnect" }).click();
    await extensionPage
      .getByRole("button", { name: "Confirm Disconnect" })
      .click();

    await expect
      .poll(() =>
        dAppPage.evaluate(
          () => (window as unknown as DAppWindow).accountEvents,
        ),
      )
      .toContainEqual([]);
    await expect
      .poll(() =>
        dAppPage.evaluate(
          () =>
            (window as unknown as DAppWindow).qrlProvider?.selectedAddress ??
            null,
        ),
      )
      .toBeNull();
    await expect
      .poll(() =>
        extensionPage.evaluate(
          async (origin) =>
            (await chrome.storage.local.get("DAPPS")).DAPPS?.ALL_DAPPS?.[
              origin
            ] ?? null,
          fixture.origin,
        ),
      )
      .toBeNull();

    await beginRequest(dAppPage, "qrl_requestAccounts");
    await approveCurrentRequest(extensionPage);
    await expect(requestResult<string[]>(dAppPage)).resolves.toEqual([
      CHECKSUM_ACCOUNT,
    ]);
    await expect
      .poll(() =>
        dAppPage.evaluate(
          () => (window as unknown as DAppWindow).accountEvents,
        ),
      )
      .toContainEqual([CHECKSUM_ACCOUNT]);

    await beginRequest(dAppPage, "wallet_revokePermissions", [
      { qrl_accounts: {} },
    ]);
    await expect(requestResult<null>(dAppPage)).resolves.toBeNull();
    await expect
      .poll(() =>
        dAppPage.evaluate(
          () => (window as unknown as DAppWindow).accountEvents,
        ),
      )
      .toContainEqual([]);
    expect(
      fixture.rpcMethods.filter((method) => method === "qrl_chainId"),
    ).toHaveLength(2);
    expect(
      fixture.rpcMethods.filter((method) => method === "net_version"),
    ).toHaveLength(2);
    expect(providerLifecycleErrors).toEqual([]);
  } finally {
    await context.close();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
  }
});
