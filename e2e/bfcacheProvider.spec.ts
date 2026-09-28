import { expect, test, chromium, type Page } from "@playwright/test";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const EXTENSION_PATH = path.join(REPO_ROOT, "Extension");

// Public deterministic fixture from canonical.json. Never fund this account.
const CHECKSUM_ACCOUNT =
  "Q6aFB7dFC849bC16E439033DfEE7B296484619Db8fc7e3b7c20a1b1688B128259338aFfd79b7cdda8F28509607bc26eB67a4799Ae457Ec82b57A6a57dea04C194";
const PROFILE_PREFIX =
  "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:";
const DAPPS_KEY = `${PROFILE_PREFIX}DAPPS`;

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
  announcements: number;
  pageShows: boolean[];
  requestStates: Record<string, DAppRequestState>;
  requestSettlements: Record<string, number>;
}

// Records every pageshow so the test can prove the back navigation was a
// real back/forward-cache restore: persisted === true rules out a reload.
// Counting EIP-6963 announcements catches a restore that re-injected the
// in-page script.
const dAppHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>bfcache provider fixture</title></head>
  <body>
    <h1>bfcache provider fixture</h1>
    <script>
      window.accountEvents = [];
      window.announcements = 0;
      window.pageShows = [];
      window.requestStates = {};
      window.requestSettlements = {};
      window.addEventListener("pageshow", (event) => {
        window.pageShows.push(event.persisted);
      });
      window.addEventListener("eip6963:announceProvider", (event) => {
        if (event.detail.info.rdns !== "com.qrlwallet.extension") return;
        window.announcements += 1;
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
    callsTo: (method: string) =>
      rpcMethods.filter((called) => called === method).length,
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

const beginRequest = async (
  page: Page,
  key: string,
  method: string,
  params?: unknown[],
) => {
  await page.evaluate(
    ({ requestKey, requestMethod, requestParams }) => {
      const dApp = window as unknown as DAppWindow;
      if (!dApp.qrlProvider) throw new Error("Provider unavailable");
      dApp.requestStates[requestKey] = { done: false };
      dApp.requestSettlements[requestKey] = 0;
      void dApp.qrlProvider
        .request({ method: requestMethod, params: requestParams })
        .then((result) => {
          dApp.requestSettlements[requestKey] += 1;
          dApp.requestStates[requestKey] = { done: true, result };
        })
        .catch((error: unknown) => {
          dApp.requestSettlements[requestKey] += 1;
          const rpcError = error as { code?: number; message?: string };
          dApp.requestStates[requestKey] = {
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

const requestResult = async <T>(
  page: Page,
  key: string,
  timeout = 20_000,
): Promise<T> => {
  await page.waitForFunction(
    (requestKey) =>
      (window as unknown as DAppWindow).requestStates[requestKey]?.done ===
      true,
    key,
    { timeout },
  );
  const state = await page.evaluate(
    (requestKey) => (window as unknown as DAppWindow).requestStates[requestKey],
    key,
  );
  if (state.error)
    throw new Error(
      `RPC ${state.error.code ?? "error"}: ${state.error.message}`,
    );
  return state.result as T;
};

// Chrome closes a page's extension ports when it enters the back/forward
// cache and tells only the service worker, so the content script has to
// treat the restore itself as the disconnect. Without that the provider
// writes into a dead port and every request after a back navigation hangs.
test("provider survives a back/forward-cache round trip", async () => {
  const fixture = await startFixtureServer();
  const profile = await mkdtemp(path.join(tmpdir(), "myqrlwallet-bfcache-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    // Playwright disables the back/forward cache by default, which is the
    // one browser feature this test is about.
    ignoreDefaultArgs: ["--disable-back-forward-cache"],
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
    // Seeding the connected-dApp record directly keeps this spec off the
    // onboarding and approval flows that quantaSwapLifecycle.spec.ts covers;
    // all this one needs is an origin the provider reports as connected.
    await serviceWorker.evaluate(
      async ({ rpcUrl, origin, account, prefix }) => {
        await chrome.storage.local.set({
          [`${prefix}SETTINGS`]: {
            sidePanelPreferred: true,
            phishingDetectionEnabled: false,
            autoLockMinutes: 30,
          },
          [`${prefix}BLOCKCHAINS`]: {
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
          [`${prefix}DAPPS`]: {
            ALL_DAPPS: {
              [origin]: {
                urlOrigin: origin,
                accounts: [account],
                blockchains: [],
                permissions: [],
              },
            },
          },
        });
      },
      {
        rpcUrl: `${fixture.origin}/rpc`,
        origin: fixture.origin,
        account: CHECKSUM_ACCOUNT,
        prefix: PROFILE_PREFIX,
      },
    );

    const dAppPage = await context.newPage();
    await dAppPage.goto(`${fixture.origin}/dapp`);
    await dAppPage.bringToFront();
    await dAppPage.waitForFunction(() =>
      Boolean((window as unknown as DAppWindow).qrlProvider),
    );
    await expect
      .poll(() =>
        dAppPage.evaluate(
          () => (window as unknown as DAppWindow).qrlProvider?.selectedAddress,
        ),
      )
      .toBe(CHECKSUM_ACCOUNT);

    // Baseline: the provider answers before the round trip.
    await beginRequest(dAppPage, "before", "qrl_blockNumber");
    await expect(requestResult(dAppPage, "before")).resolves.toBe("0x1");

    // A request still in flight when the page is cached must settle rather
    // than hang: its answer is written to a port the browser has already
    // closed, so the content script has to replay it on the new connection.
    const blockCallsBeforeRoundTrip = fixture.callsTo("qrl_blockNumber");
    fixture.holdRpc("qrl_blockNumber");
    await beginRequest(dAppPage, "inFlight", "qrl_blockNumber");
    await expect
      .poll(() => fixture.callsTo("qrl_blockNumber"))
      .toBe(blockCallsBeforeRoundTrip + 1);

    await dAppPage.goto(`${fixture.origin}/away`);
    // A restore from the back/forward cache fires no load event, so commit
    // is as far as this navigation can be awaited.
    await dAppPage.goBack({ waitUntil: "commit" });
    await expect
      .poll(() =>
        dAppPage.evaluate(() => (window as unknown as DAppWindow).pageShows),
      )
      .toEqual([false, true]);

    await expect
      .poll(() => fixture.callsTo("qrl_blockNumber"), { timeout: 20_000 })
      .toBe(blockCallsBeforeRoundTrip + 2);
    fixture.releaseHeldRpc();
    await expect(requestResult(dAppPage, "inFlight")).resolves.toBe("0x1");

    // A request issued after the restore must be answered too.
    await beginRequest(dAppPage, "after", "web3_clientVersion");
    await expect(requestResult(dAppPage, "after")).resolves.toBe(
      "myqrlwallet-e2e",
    );

    // The account subscription has to survive the restore as well: the
    // service worker registers its notification stream per port, so a
    // reconnect that never happened leaves the dApp deaf to revocation.
    await serviceWorker.evaluate(
      async ({ storageKey, origin }) => {
        const stored = (await chrome.storage.local.get(storageKey))[storageKey];
        stored.ALL_DAPPS[origin].accounts = [];
        await chrome.storage.local.set({ [storageKey]: stored });
      },
      { storageKey: DAPPS_KEY, origin: fixture.origin },
    );
    await expect
      .poll(
        () =>
          dAppPage.evaluate(
            () => (window as unknown as DAppWindow).accountEvents,
          ),
        { timeout: 20_000 },
      )
      .toContainEqual([]);

    // Restoring a page reuses its JavaScript context, so the in-page script
    // must not have run a second time.
    expect(
      await dAppPage.evaluate(
        () => (window as unknown as DAppWindow).announcements,
      ),
    ).toBe(1);
    await dAppPage.waitForTimeout(500);
    expect(
      await dAppPage.evaluate(
        () => (window as unknown as DAppWindow).requestSettlements,
      ),
    ).toEqual({ before: 1, inFlight: 1, after: 1 });
    expect(providerLifecycleErrors).toEqual([]);
  } finally {
    await context.close();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
  }
});
