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
  SCHEME_TAG_MSG,
  SCHEME_VERSION_MSG,
} from "../src/functions/pqSigning/ctx";
import { computeMessageDigest } from "../src/functions/pqSigning/messageDigest";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const EXTENSION_PATH = path.join(REPO_ROOT, "Extension");

// Public deterministic fixture from canonical.json. Never fund this account.
const TEST_ONLY_HEX_SEED =
  "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";
const CHECKSUM_ACCOUNT =
  "Q6aFB7dFC849bC16E439033DfEE7B296484619Db8fc7e3b7c20a1b1688B128259338aFfd79b7cdda8F28509607bc26eB67a4799Ae457Ec82b57A6a57dea04C194";
const CANONICAL_ACCOUNT = `Q${CHECKSUM_ACCOUNT.slice(1).toLowerCase()}`;
const MESSAGE_HEX = "0x5175616e746153776170205149502d353520453245";

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
    case "qrl_getBlockByNumber":
      return {
        hash: "0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4",
      };
    case "qrl_chainId":
      return "0x301825";
    case "net_version":
      return "3151909";
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

test("QuantaSwap connect, lowercase PQ message sign, disconnect, and reconnect", async () => {
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
          KEYSTORES: "legacy-v2-encrypted-record",
          ACCOUNTS: { ALL_ACCOUNTS: [`Q${"a".repeat(40)}`] },
          "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:SETTINGS":
            {
              sidePanelPreferred: true,
              phishingDetectionEnabled: false,
              autoLockMinutes: 30,
            },
          "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:BLOCKCHAINS":
            {
              ACTIVE_BLOCKCHAIN: "0x301825",
              ALL_BLOCKCHAINS: [
                {
                  chainId: "0x301825",
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
    const pageErrors: string[] = [];
    for (const query of ["", "?sidepanel=true", "?tab=true"]) {
      const surface = await context.newPage();
      surface.on("pageerror", (error) => pageErrors.push(error.message));
      await surface.goto(
        `chrome-extension://${extensionId}/index.html${query}`,
      );
      await expect(surface.locator("#root")).not.toBeEmpty();
      await expect(
        surface.getByText("v3 Private", { exact: true }),
      ).toBeVisible();
      await surface.close();
    }
    expect(pageErrors).toEqual([]);
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
    // Done closes the onboarding tab. The close can land while the click is
    // still settling, which Playwright reports as a closed target; that is
    // the expected outcome, so only a click on a still-open page may fail.
    await extensionPage
      .getByRole("button", { name: "Done" })
      .click({ noWaitAfter: true })
      .catch((error: unknown) => {
        if (!extensionPage.isClosed()) throw error;
      });
    await onboardingClosed;
    await expect
      .poll(
        () =>
          serviceWorker.evaluate(async (expectedAccount) => {
            const {
              ["v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:KEYSTORES"]:
                KEYSTORES,
              ["v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:ACCOUNTS"]:
                ACCOUNTS,
            } = await chrome.storage.local.get([
              "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:KEYSTORES",
              "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:ACCOUNTS",
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
      .toBe("0x301825");
    expect(fixture.rpcMethods).toContain("qrl_chainId");
    await beginRequest(dAppPage, "qrl_walletCapabilities");
    await expect(requestResult(dAppPage)).resolves.toEqual({
      addressScheme: "qip55-64",
      chainId: "0x301825",
      genesisHash:
        "0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4",
    });
    expect(
      await dAppPage.evaluate(
        () => (window as unknown as DAppWindow).qrlProvider?.selectedAddress,
      ),
    ).toBeNull();
    expect(
      await serviceWorker.evaluate(
        async () => (await chrome.storage.local.get("KEYSTORES")).KEYSTORES,
      ),
    ).toBe("legacy-v2-encrypted-record");

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
            (
              await chrome.storage.session.get(
                "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:DAPPS",
              )
            )[
              "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:DAPPS"
            ]?.DAPPS_REQUEST_DATA?.method ?? null,
        ),
      )
      .toBe("qrl_requestAccounts");
    await approveCurrentRequest(extensionPage);
    await expect(requestResult<string[]>(dAppPage)).resolves.toEqual([
      CHECKSUM_ACCOUNT,
    ]);

    const storedConnection = await extensionPage.evaluate(
      async (origin) =>
        (
          await chrome.storage.local.get(
            "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:DAPPS",
          )
        )[
          "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:DAPPS"
        ]?.ALL_DAPPS?.[origin],
      fixture.origin,
    );
    expect(storedConnection?.accounts).toEqual([CHECKSUM_ACCOUNT]);

    await beginRequest(dAppPage, "qrl_sendTransaction", [
      {
        from: CHECKSUM_ACCOUNT,
        to: CHECKSUM_ACCOUNT,
        chainId: "0x301825",
        value: "0x0",
        gas: "0x5208",
        data: "0x01",
      },
    ]);
    await expect(
      extensionPage.getByRole("button", { name: "Yes" }),
    ).toBeEnabled();
    const transactionChain = await extensionPage.evaluate(async () => {
      const key =
        "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:DAPPS";
      return (await chrome.storage.session.get(key))[key]?.DAPPS_REQUEST_DATA
        ?.params?.[0]?.chainId;
    });
    expect(transactionChain).toBe("0x301825");
    await extensionPage
      .getByRole("button", { name: "No", exact: true })
      .click();
    await expect(requestResult(dAppPage)).rejects.toThrow(/4001|reject/i);

    await beginRequest(dAppPage, "qrl_sendTransaction", [
      {
        from: CHECKSUM_ACCOUNT,
        to: CHECKSUM_ACCOUNT,
        chainId: "0x539",
        value: "0x0",
        gas: "0x5208",
      },
    ]);
    await expect(requestResult(dAppPage)).rejects.toThrow(
      "does not match the active, authorized wallet chain",
    );
    expect(fixture.rpcMethods).not.toContain("qrl_sendRawTransaction");

    const chainIdCallsBeforeReload = fixture.rpcMethods.filter(
      (method) => method === "qrl_chainId",
    ).length;
    expect(chainIdCallsBeforeReload).toBeGreaterThan(0);

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

    await beginRequest(dAppPage, "qrl_signMessage", [
      CANONICAL_ACCOUNT,
      MESSAGE_HEX,
    ]);
    await approveCurrentRequest(extensionPage);
    const proof = await requestResult<SignProof>(dAppPage);
    const digest = computeMessageDigest(hexToBytes(MESSAGE_HEX));
    expect(proof.schemeVersion).toBe(SCHEME_VERSION_MSG);
    expect(proof.digest).toBe(bytesToHex(digest));
    expect(`Q${proof.signer.slice(1).toLowerCase()}`).toBe(CANONICAL_ACCOUNT);
    expect(
      cryptoSignVerify(
        hexToBytes(proof.signature),
        digest,
        hexToBytes(proof.publicKey),
        SCHEME_TAG_MSG,
      ),
    ).toBe(true);
    const signerHash = shake256(
      concatBytes(hexToBytes(proof.descriptor), hexToBytes(proof.publicKey)),
      { dkLen: 64 },
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
            (
              await chrome.storage.local.get(
                "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:DAPPS",
              )
            )[
              "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:DAPPS"
            ]?.ALL_DAPPS?.[origin] ?? null,
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
      fixture.rpcMethods.filter((method) => method === "qrl_chainId").length,
    ).toBeGreaterThanOrEqual(chainIdCallsBeforeReload + 2);
    expect(
      fixture.rpcMethods.filter((method) => method === "net_version"),
    ).toHaveLength(2);
    expect(providerLifecycleErrors).toEqual([]);
    expect(
      await extensionPage.evaluate(
        async () => (await chrome.storage.local.get("KEYSTORES")).KEYSTORES,
      ),
    ).toBe("legacy-v2-encrypted-record");
  } finally {
    await context.close();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
  }
});
