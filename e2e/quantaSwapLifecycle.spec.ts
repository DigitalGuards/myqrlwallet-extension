import { readApprovalTransaction } from "../src/utilities/approvalGuards";
import {
  beginFixtureRequest,
  closeFixtureServer,
  fixtureRequestResult,
  hasFixtureAccount,
  hasFixtureProvider,
  isRequestState,
  isSignProof,
  readPendingRequest,
  readProviderProperty,
  readRpcBody,
  readStoredValue,
  readWindowValue,
  reportFixtureError,
  storedConnection,
  writeStorage,
  type DAppRequest,
} from "./fixtureHelpers";
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
const STORAGE_PREFIX =
  "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4";
const DAPPS_KEY = `${STORAGE_PREFIX}:DAPPS`;

// Public deterministic fixture from canonical.json. Never fund this account.
const TEST_ONLY_HEX_SEED =
  "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";
const CHECKSUM_ACCOUNT =
  "Q6aFB7dFC849bC16E439033DfEE7B296484619Db8fc7e3b7c20a1b1688B128259338aFfd79b7cdda8F28509607bc26eB67a4799Ae457Ec82b57A6a57dea04C194";
const CANONICAL_ACCOUNT = `Q${CHECKSUM_ACCOUNT.slice(1).toLowerCase()}`;
const MESSAGE_HEX = "0x5175616e746153776170205149502d353520453245";

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

const handleRpc = async (
  request: IncomingMessage,
  response: ServerResponse,
  methods: string[],
  waitForHeldRpc: (methods: string[]) => Promise<void>,
) => {
  const body = await readRpcBody(request);
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
    await new Promise<void>((resolve) => {
      heldRpcResolvers.push(resolve);
    });
  };
  const releaseHeldRpc = () => {
    heldRpcMethods.clear();
    const resolvers = heldRpcResolvers;
    heldRpcResolvers = [];
    resolvers.forEach((resolve) => {
      resolve();
    });
  };
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/rpc") {
      handleRpc(request, response, rpcMethods, waitForHeldRpc).catch(
        (error: unknown) => {
          reportFixtureError(response, error);
        },
      );
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
      return closeFixtureServer(server);
    },
  };
};

const waitForProvider = async (page: Page) => {
  await page.waitForFunction(hasFixtureProvider);
};

const beginRequest = async (
  page: Page,
  method: string,
  params?: DAppRequest["params"],
) => {
  await page.evaluate(beginFixtureRequest, {
    stateKey: "requestState" as const,
    settlementsKey: "requestSettlements" as const,
    method,
    params,
  });
};

const requestResult = (page: Page) =>
  fixtureRequestResult(page, { stateKey: "requestState" as const });

const beginTrackedRequest = async (
  page: Page,
  key: string,
  method: string,
  params?: unknown[],
) => {
  await page.evaluate(beginFixtureRequest, {
    stateKey: "trackedRequestStates" as const,
    requestKey: key,
    settlementsKey: "trackedRequestSettlements" as const,
    method,
    params,
  });
};

const trackedRequestResult = (page: Page, key: string) =>
  fixtureRequestResult(page, {
    stateKey: "trackedRequestStates" as const,
    requestKey: key,
  });

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
    await writeStorage(serviceWorker, "local", {
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
              rpcUrls: [`${fixture.origin}/rpc`],
              blockExplorerUrls: ["https://example.invalid"],
              nativeCurrency: {
                name: "Quanta",
                symbol: "Quanta",
                decimals: 18,
              },
              iconUrls: [],
              defaultRpcUrl: `${fixture.origin}/rpc`,
              defaultBlockExplorerUrl: "https://example.invalid",
              defaultIconUrl: "",
              isTestnet: true,
              defaultWsRpcUrl: `${fixture.origin}/rpc`,
              isCustomChain: true,
            },
          ],
        },
    });

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
          hasFixtureAccount(serviceWorker, STORAGE_PREFIX, CHECKSUM_ACCOUNT),
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
      .poll(() => dAppPage.evaluate(readProviderProperty, "chainId"))
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
      await dAppPage.evaluate(readProviderProperty, "selectedAddress"),
    ).toBeNull();
    expect(await readStoredValue(serviceWorker, "local", "KEYSTORES")).toBe(
      "legacy-v2-encrypted-record",
    );

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
        trackedRequestResult(dAppPage, "interrupted"),
        trackedRequestResult(dAppPage, "during-reconnect"),
      ]),
    ).resolves.toEqual(["0x1", "myqrlwallet-e2e"]);
    await dAppPage.waitForTimeout(100);
    expect(
      await dAppPage.evaluate(readWindowValue, "trackedRequestSettlements"),
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

    // The service worker restart above drops its in-memory decrypted keys
    // by design (F4): extensionPage's own keep-alive port disconnected
    // right along with it, so this store already applied that as a local
    // lock, independent of - and faster than - the worker actually coming
    // back. A real re-unlock is required before this surface can approve
    // anything again.
    await extensionPage.getByRole("button", { name: "Unlock" }).waitFor();
    await extensionPage.getByLabel("Enter password").fill("e2e-password-only");
    await extensionPage.getByRole("button", { name: "Unlock" }).click();
    await expect(
      extensionPage.getByRole("heading", { name: "Active account" }),
    ).toBeVisible();

    await beginRequest(dAppPage, "qrl_requestAccounts");
    await dAppPage.waitForTimeout(500);
    const earlyRequestState = await dAppPage.evaluate(
      readWindowValue,
      "requestState",
    );
    if (earlyRequestState !== undefined && !isRequestState(earlyRequestState)) {
      throw new Error("Invalid fixture request state");
    }
    if (earlyRequestState?.error) {
      throw new Error(
        `qrl_requestAccounts failed before approval: ${JSON.stringify(earlyRequestState.error)}`,
      );
    }
    await expect
      .poll(() =>
        readPendingRequest(extensionPage, DAPPS_KEY).then(
          (request) => request?.method ?? null,
        ),
      )
      .toBe("qrl_requestAccounts");
    await approveCurrentRequest(extensionPage);
    await expect(requestResult(dAppPage)).resolves.toEqual([CHECKSUM_ACCOUNT]);

    const connection = storedConnection(
      await readStoredValue(extensionPage, "local", DAPPS_KEY),
      fixture.origin,
    );
    expect(connection?.accounts).toEqual([CHECKSUM_ACCOUNT]);

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
    const transaction = readApprovalTransaction(
      (await readPendingRequest(extensionPage, DAPPS_KEY))?.params,
    );
    expect(transaction?.chainId).toBe("0x301825");
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
      .poll(() => dAppPage.evaluate(readProviderProperty, "selectedAddress"))
      .toBe(CHECKSUM_ACCOUNT);
    // The provider state is served from the stored active chain now, so a
    // page load asks the node nothing. It used to issue qrl_chainId and
    // net_version on every load, which is why an unreachable node put an
    // RPC error and a "please report this bug" line in the console of
    // every website the user visited.
    expect(
      fixture.rpcMethods.filter((method) => method === "qrl_chainId").length,
    ).toBe(chainIdCallsBeforeReload);

    await beginRequest(dAppPage, "qrl_signMessage", [
      CANONICAL_ACCOUNT,
      MESSAGE_HEX,
    ]);
    await approveCurrentRequest(extensionPage);
    const proof = await requestResult(dAppPage);
    if (!isSignProof(proof)) throw new Error("Invalid fixture signing proof");
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
      .poll(() => dAppPage.evaluate(readWindowValue, "accountEvents"))
      .toContainEqual([]);
    await expect
      .poll(() => dAppPage.evaluate(readProviderProperty, "selectedAddress"))
      .toBeNull();
    await expect
      .poll(() =>
        readStoredValue(extensionPage, "local", DAPPS_KEY).then(
          (stored) => storedConnection(stored, fixture.origin) ?? null,
        ),
      )
      .toBeNull();

    await beginRequest(dAppPage, "qrl_requestAccounts", {});
    await expect
      .poll(() => readPendingRequest(extensionPage, DAPPS_KEY))
      .toMatchObject({ method: "qrl_requestAccounts", params: {} });
    await approveCurrentRequest(extensionPage);
    await expect(requestResult(dAppPage)).resolves.toEqual([CHECKSUM_ACCOUNT]);
    await expect
      .poll(() => dAppPage.evaluate(readWindowValue, "accountEvents"))
      .toContainEqual([CHECKSUM_ACCOUNT]);

    await beginRequest(dAppPage, "wallet_revokePermissions", [
      { qrl_accounts: {} },
    ]);
    await expect(requestResult(dAppPage)).resolves.toBeNull();
    await expect
      .poll(() => dAppPage.evaluate(readWindowValue, "accountEvents"))
      .toContainEqual([]);
    // The authorization checks still read the chain from the node; only
    // the per-page-load provider state stopped doing so.
    expect(
      fixture.rpcMethods.filter((method) => method === "qrl_chainId").length,
    ).toBeGreaterThan(chainIdCallsBeforeReload);
    // net_version was only ever asked for the provider state, which is now
    // answered from storage, so nothing asks the node for it at all.
    expect(
      fixture.rpcMethods.filter((method) => method === "net_version"),
    ).toHaveLength(0);
    expect(providerLifecycleErrors).toEqual([]);
    expect(await readStoredValue(extensionPage, "local", "KEYSTORES")).toBe(
      "legacy-v2-encrypted-record",
    );
  } finally {
    await context.close();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
  }
});
