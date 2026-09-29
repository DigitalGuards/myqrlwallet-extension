import { expect, test, chromium } from "@playwright/test";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Two lifecycle guarantees, verified in a real browser against a fixture
 * node:
 *
 * - a locked wallet polls nothing, and unlocking refreshes at once;
 * - a node that stops answering turns the connection red and says the
 *   balances on screen are no longer current.
 *
 * Both are timer driven, so the page clock is faked and advanced instead
 * of waiting out real poll intervals.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const EXTENSION_PATH = path.join(REPO_ROOT, "Extension");

// Public deterministic fixture from canonical.json. Never fund this account.
const TEST_ONLY_HEX_SEED =
  "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";

const GENESIS_HASH =
  "0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4";
const STORAGE_PREFIX = `v3:0x301825:${GENESIS_HASH}`;

const rpcResult = (method: string): unknown => {
  switch (method) {
    case "qrl_getBlockByNumber":
      return { hash: GENESIS_HASH };
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

const startFixtureNode = async () => {
  const rpcMethods: string[] = [];
  let answering = true;
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/rpc") {
      response.writeHead(404).end();
      return;
    }
    void (async () => {
      const body = JSON.parse(await readBody(request)) as
        | { id?: string | number; method: string }
        | Array<{ id?: string | number; method: string }>;
      const requests = Array.isArray(body) ? body : [body];
      rpcMethods.push(...requests.map(({ method }) => method));
      if (!answering) {
        // The node is up but broken: every call errors, the way a node
        // mid-resync or with a dead RPC layer does.
        response.writeHead(503).end();
        return;
      }
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
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture node did not bind TCP");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    rpcMethods,
    stopAnswering: () => {
      answering = false;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

test("balance polling follows lock state and a dead node marks balances stale", async () => {
  const node = await startFixtureNode();
  const profile = await mkdtemp(path.join(tmpdir(), "myqrlwallet-lifecycle-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    ],
  });

  try {
    const serviceWorker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(serviceWorker.url()).host;
    await serviceWorker.evaluate(
      async ({ rpcUrl, prefix }) => {
        await chrome.storage.local.set({
          [`${prefix}:SETTINGS`]: {
            phishingDetectionEnabled: false,
            autoLockMinutes: 30,
          },
          [`${prefix}:BLOCKCHAINS`]: {
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
      { rpcUrl: `${node.origin}/rpc`, prefix: STORAGE_PREFIX },
    );

    const onboarding = await context.newPage();
    await onboarding.goto(
      `chrome-extension://${extensionId}/index.html?tab=true`,
    );
    await onboarding.getByRole("button", { name: "Continue" }).click();
    await onboarding
      .getByLabel("password", { exact: true })
      .fill("e2e-password-only");
    await onboarding.getByLabel("reEnteredPassword").fill("e2e-password-only");
    await onboarding.getByRole("button", { name: "Continue" }).click();
    await onboarding
      .getByRole("button", { name: "Import an existing account" })
      .click();
    await onboarding.getByRole("tab", { name: "Hex seed" }).click();
    await onboarding
      .getByRole("textbox", { name: "hexSeed" })
      .fill(TEST_ONLY_HEX_SEED);
    await onboarding.getByRole("button", { name: "Import account" }).click();
    await onboarding.getByRole("button", { name: "Continue" }).click();
    await expect(
      onboarding.getByRole("heading", { name: "That's All" }),
    ).toBeVisible();
    const onboardingClosed = onboarding.waitForEvent("close");
    await onboarding
      .getByRole("button", { name: "Done" })
      .click({ noWaitAfter: true })
      .catch((error: unknown) => {
        if (!onboarding.isClosed()) throw error;
      });
    await onboardingClosed;

    const wallet = await context.newPage();
    // The poll ticks are what this test drives, so time is faked here and
    // advanced deliberately. Installed before navigation so the page never
    // sees the real clock.
    await wallet.clock.install();
    await wallet.goto(`chrome-extension://${extensionId}/index.html?tab=true`);
    await wallet.bringToFront();
    await expect(
      wallet.getByRole("heading", { name: "Active account" }),
    ).toBeVisible();
    const staleNotice = wallet.getByText("Balances may be out of date");
    await expect(staleNotice).toHaveCount(0);

    // An unlocked, visible wallet polls.
    const beforeUnlockedTick = node.rpcMethods.length;
    await wallet.clock.runFor(35_000);
    await expect
      .poll(() => node.rpcMethods.length, { timeout: 15_000 })
      .toBeGreaterThan(beforeUnlockedTick);

    // Locking stops the loop: a password prompt needs no balances.
    await wallet.getByRole("button", { name: "More" }).first().click();
    await wallet.getByText("Lock Wallet").click();
    await expect(
      wallet.getByRole("button", { name: "Unlock", exact: true }),
    ).toBeVisible();
    // Let anything already in flight land before taking the baseline.
    await wallet.clock.runFor(2_000);
    const whileLocked = node.rpcMethods.length;
    await wallet.clock.runFor(120_000);
    await wallet.waitForTimeout(1_000);
    expect(node.rpcMethods.length).toBe(whileLocked);

    // Unlocking refreshes straight away instead of waiting out a tick.
    await wallet
      .getByLabel("Enter password", { exact: true })
      .fill("e2e-password-only");
    await wallet.getByRole("button", { name: "Unlock", exact: true }).click();
    await expect(
      wallet.getByRole("heading", { name: "Active account" }),
    ).toBeVisible();
    await expect
      .poll(() => node.rpcMethods.length, { timeout: 30_000 })
      .toBeGreaterThan(whileLocked);

    // The node stops answering. The status used to stay green with hours
    // old balances presented as current.
    node.stopAnswering();
    await wallet.clock.runFor(35_000);
    await expect(staleNotice.first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await context.close();
    await node.close();
    await rm(profile, { recursive: true, force: true });
  }
});
