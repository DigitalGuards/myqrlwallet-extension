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
// The hex seed below derives exactly this address, so the onboarding import
// this spec runs ends up holding the account the seeded grant names.
const TEST_ONLY_HEX_SEED =
  "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";
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
    const extensionId = new URL(serviceWorker.url()).host;
    // Seeding the connected-dApp record directly keeps this spec off the
    // approval flow that quantaSwapLifecycle.spec.ts covers; all this one
    // needs is an origin the provider reports as connected.
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

    // The grant is seeded, but a locked wallet reports no accounts to the
    // page, exactly as qrl_accounts does. Onboarding the seeded account
    // unlocks the wallet, which is what puts the address in front of the
    // dApp and makes the revocation later in this test a real change.
    const extensionPage = await context.newPage();
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
    await extensionPage.close();

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

    // A state-changing request in flight at the same moment must NOT be
    // replayed: only the page freezes, so the service worker may well have
    // carried it out while the answer was dropped on the closed port.
    // qrl_sendRawTransaction checks the network before it broadcasts, so
    // holding qrl_getBlockByNumber parks it inside the worker with nothing
    // sent yet.
    const networkCallsBeforeRoundTrip = fixture.callsTo("qrl_getBlockByNumber");
    fixture.holdRpc("qrl_getBlockByNumber");
    await beginRequest(dAppPage, "inFlightWrite", "qrl_sendRawTransaction", [
      "0x02f8650182031825808082520894000000000000000000000000000000000000000080c0",
    ]);
    await expect
      .poll(() => fixture.callsTo("qrl_getBlockByNumber"))
      .toBe(networkCallsBeforeRoundTrip + 1);

    await dAppPage.goto(`${fixture.origin}/away`);
    // A restore from the back/forward cache fires no load event, so commit
    // is as far as this navigation can be awaited.
    await dAppPage.goBack({ waitUntil: "commit" });
    await expect
      .poll(() =>
        dAppPage.evaluate(() => (window as unknown as DAppWindow).pageShows),
      )
      .toEqual([false, true]);

    // The read is replayed onto the rebuilt connection.
    await expect
      .poll(() => fixture.callsTo("qrl_blockNumber"), { timeout: 20_000 })
      .toBe(blockCallsBeforeRoundTrip + 2);

    // The write is settled toward the page with a definite error, and it is
    // never handed to the service worker again.
    await expect(requestResult(dAppPage, "inFlightWrite")).rejects.toThrow(
      /Connection to the wallet was reset/,
    );
    expect(fixture.callsTo("qrl_getBlockByNumber")).toBe(
      networkCallsBeforeRoundTrip + 1,
    );
    expect(fixture.callsTo("qrl_sendRawTransaction")).toBe(0);

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

    // Back, Forward, Back on one tab caches and restores this page a second
    // time only milliseconds after the first. That second cache entry closes
    // the port the first restore opened, so a rebuild suppressed as a
    // duplicate would leave the page on a dead port with no disconnect ever
    // delivered.
    const restoreStartedAt = Date.now();
    await dAppPage.goForward({ waitUntil: "commit" });
    await dAppPage.goBack({ waitUntil: "commit" });
    await expect
      .poll(() =>
        dAppPage.evaluate(() => (window as unknown as DAppWindow).pageShows),
      )
      .toEqual([false, true, true]);
    const secondRestoreGapMs = Date.now() - restoreStartedAt;

    await beginRequest(dAppPage, "afterSecondRestore", "web3_clientVersion");
    await expect(requestResult(dAppPage, "afterSecondRestore")).resolves.toBe(
      "myqrlwallet-e2e",
    );
    // A wall-clock duplicate filter would have to be shorter than this gap
    // to let the second rebuild through, and a human double-click on Back is
    // 100 to 300 ms, so the pairing cannot be done on time alone.
    expect(secondRestoreGapMs).toBeLessThan(2_000);

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
    ).toEqual({
      before: 1,
      inFlight: 1,
      inFlightWrite: 1,
      after: 1,
      afterSecondRestore: 1,
    });
    // One user action can reach the node at most once. The orphaned first
    // attempt may still finish inside the worker after the hold is released;
    // what must never happen is a second broadcast from the replay.
    expect(fixture.callsTo("qrl_sendRawTransaction")).toBeLessThanOrEqual(1);
    expect(providerLifecycleErrors).toEqual([]);
  } finally {
    await context.close();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
  }
});
