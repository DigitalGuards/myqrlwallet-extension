import { expect, test, chromium, type Page } from "@playwright/test";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  encodeFunctionSignature,
  encodeParameters,
} from "@theqrl/web3-qrl-abi";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const EXTENSION_PATH = path.join(REPO_ROOT, "Extension");
// Screenshots are a side errand: set CALLDATA_SHOT_DIR to collect them.
// The assertions below are what this spec is for.
const SHOT_DIR = process.env.CALLDATA_SHOT_DIR;

const TEST_ONLY_HEX_SEED =
  "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";
const CHECKSUM_ACCOUNT =
  "Q6aFB7dFC849bC16E439033DfEE7B296484619Db8fc7e3b7c20a1b1688B128259338aFfd79b7cdda8F28509607bc26eB67a4799Ae457Ec82b57A6a57dea04C194";
const GENESIS =
  "0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4";
const PROFILE = `v3:0x301825:${GENESIS}`;
const TOKEN_CONTRACT = `Q${"11".repeat(64)}`;
const COLLECTION_CONTRACT = `Q${"22".repeat(64)}`;
const SPENDER = `Q${"ab".repeat(64)}`;
const MAX_UINT256 = (1n << 256n) - 1n;

const call = (signature: string, types: string[], values: unknown[]) =>
  `${encodeFunctionSignature(signature)}${encodeParameters(types, values).slice(2)}`;

interface QrlProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: "accountsChanged", listener: (accounts: string[]) => void): void;
  chainId: string | null;
}

interface DAppWindow extends Window {
  qrlProvider?: QrlProvider;
  requestState?: { done: boolean; result?: unknown; error?: unknown };
}

const dAppHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>Calldata screenshot fixture</title></head>
<body><h1>Calldata screenshot fixture</h1>
<script>
  window.addEventListener("eip6963:announceProvider", (event) => {
    if (event.detail.info.rdns !== "com.qrlwallet.extension") return;
    window.qrlProvider = event.detail.provider;
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
</script></body></html>`;

const rpcResult = (method: string): unknown => {
  switch (method) {
    case "qrl_getBlockByNumber":
      return { hash: GENESIS, baseFeePerGas: "0x3b9aca00" };
    case "qrl_chainId":
      return "0x301825";
    case "net_version":
      return "3151909";
    case "net_listening":
      return true;
    case "qrl_getBalance":
      return "0x56bc75e2d63100000";
    case "qrl_blockNumber":
      return "0x1";
    case "qrl_gasPrice":
      return "0x77359400";
    case "qrl_maxPriorityFeePerGas":
      return "0x3b9aca00";
    case "qrl_estimateGas":
      return "0xb3b0";
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

const startFixtureServer = async () => {
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/rpc") {
      void (async () => {
        const body = JSON.parse(await readBody(request)) as
          | { id?: string | number; method: string }
          | Array<{ id?: string | number; method: string }>;
        const requests = Array.isArray(body) ? body : [body];
        response.writeHead(200, {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json",
        });
        const results = requests.map(({ id, method }) => ({
          jsonrpc: "2.0",
          id: id ?? null,
          result: rpcResult(method),
        }));
        response.end(
          JSON.stringify(Array.isArray(body) ? results : results[0]),
        );
      })();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(dAppHtml);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind TCP");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

const beginRequest = async (page: Page, method: string, params: unknown[]) => {
  await page.evaluate(
    ({ requestMethod, requestParams }) => {
      const dApp = window as unknown as DAppWindow;
      if (!dApp.qrlProvider) throw new Error("Provider unavailable");
      dApp.requestState = { done: false };
      void dApp.qrlProvider
        .request({ method: requestMethod, params: requestParams })
        .then((result) => {
          dApp.requestState = { done: true, result };
        })
        .catch((error: unknown) => {
          dApp.requestState = { done: true, error };
        });
    },
    { requestMethod: method, requestParams: params },
  );
};

test("puts a decoded token approval in words on the approval screen", async () => {
  if (SHOT_DIR) await mkdir(SHOT_DIR, { recursive: true });
  const fixture = await startFixtureServer();
  const profile = await mkdtemp(path.join(tmpdir(), "myqrlwallet-shots-"));
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
      async ({ rpcUrl, profileKey }) => {
        await chrome.storage.local.set({
          [`${profileKey}:SETTINGS`]: {
            sidePanelPreferred: false,
            phishingDetectionEnabled: false,
            autoLockMinutes: 30,
          },
          [`${profileKey}:BLOCKCHAINS`]: {
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
      { rpcUrl: `${fixture.origin}/rpc`, profileKey: PROFILE },
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
    await extensionPage
      .getByRole("button", { name: "Done" })
      .click({ noWaitAfter: true })
      .catch((error: unknown) => {
        if (!extensionPage.isClosed()) throw error;
      });
    await onboardingClosed;

    // An imported token and collection so the summary can name the asset.
    await serviceWorker.evaluate(
      async ({ profileKey, account, tokenAddress, collectionAddress }) => {
        await chrome.storage.local.set({
          [`${profileKey}:TOKENS`]: {
            ALL_TOKENS: {
              [account]: {
                "0x301825": {
                  tokens: [
                    {
                      address: tokenAddress,
                      symbol: "MQW",
                      decimals: 18,
                      image: "",
                    },
                  ],
                },
              },
            },
          },
          [`${profileKey}:NFT_COLLECTIONS`]: {
            ALL_NFT_COLLECTIONS: {
              [account]: {
                "0x301825": {
                  collections: [
                    {
                      address: collectionAddress,
                      name: "Quanta Relics",
                      symbol: "RELIC",
                      standard: "ZRC721",
                      image: "",
                    },
                  ],
                },
              },
            },
          },
          [`${profileKey}:CONTACTS`]: {
            ALL_CONTACTS: [],
          },
        });
      },
      {
        profileKey: PROFILE,
        account: CHECKSUM_ACCOUNT,
        tokenAddress: TOKEN_CONTRACT,
        collectionAddress: COLLECTION_CONTRACT,
      },
    );

    extensionPage = await context.newPage();
    await extensionPage.setViewportSize({ width: 360, height: 2000 });
    await extensionPage.goto(
      `chrome-extension://${extensionId}/index.html?tab=true`,
    );
    await expect(
      extensionPage.getByRole("heading", { name: "Active account" }),
    ).toBeVisible();

    const dAppPage = await context.newPage();
    await dAppPage.goto(fixture.origin);
    await dAppPage.bringToFront();
    await dAppPage.waitForFunction(() =>
      Boolean((window as unknown as DAppWindow).qrlProvider),
    );

    await beginRequest(dAppPage, "qrl_requestAccounts", []);
    const yes = extensionPage.getByRole("button", { name: "Yes" });
    await expect(yes).toBeEnabled();
    await yes.click();

    // Rejecting several requests back to back arms the per-origin approval
    // cooldown (approvalSlot.ts: two refusals of grace, then five seconds),
    // which is exactly the behaviour that keeps a page from reopening the
    // wallet in a loop. This spec walks through more refusals than that, so
    // it waits the cooldown out and asks again.
    const APPROVAL_COOLDOWN_WAIT_MS = 5_500;
    const openApproval = async (data: string, to: string) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await beginRequest(dAppPage, "qrl_sendTransaction", [
          {
            from: CHECKSUM_ACCOUNT,
            to,
            chainId: "0x301825",
            value: "0x0",
            gas: "0x7a120",
            type: "0x2",
            data,
          },
        ]);
        const opened = await extensionPage
          .getByRole("button", { name: "Yes" })
          .waitFor({ state: "visible", timeout: 6_000 })
          .then(() => true)
          .catch(() => false);
        if (opened) {
          await expect(
            extensionPage.getByRole("button", { name: "Yes" }),
          ).toBeEnabled();
          return;
        }
        await extensionPage.waitForTimeout(APPROVAL_COOLDOWN_WAIT_MS);
      }
      throw new Error("The approval surface never opened");
    };

    const rejectApproval = async () => {
      await extensionPage
        .getByRole("button", { name: "No", exact: true })
        .click();
      await dAppPage.waitForFunction(
        () => (window as unknown as DAppWindow).requestState?.done === true,
      );
    };

    const capture = async (name: string) => {
      if (!SHOT_DIR) return;
      await extensionPage.screenshot({
        path: path.join(SHOT_DIR, name),
        fullPage: true,
      });
    };

    await openApproval(
      call(
        "approve(address,uint256)",
        ["address", "uint256"],
        [SPENDER, MAX_UINT256.toString()],
      ),
      TOKEN_CONTRACT,
    );
    await expect(
      extensionPage.getByText("Approve token spending"),
    ).toBeVisible();
    await expect(extensionPage.getByText("MQW", { exact: true })).toBeVisible();
    await expect(
      extensionPage.getByText(
        "This allows spending more than the token's entire supply. It is effectively unlimited: the spender can move your whole balance at any time, now and in the future.",
      ),
    ).toBeVisible();
    await expect(
      extensionPage.getByText("Unlimited", { exact: true }),
    ).toBeVisible();
    // The requested limit is shown as requested, with the wallet's own
    // estimate beside it and the ceiling it implies.
    await expect(extensionPage.getByText("500000")).toBeVisible();
    await expect(extensionPage.getByText("Wallet gas estimate")).toBeVisible();
    await expect(
      extensionPage.getByText("Maximum fee", { exact: true }),
    ).toBeVisible();
    await expect(extensionPage.getByText("0.00125 Quanta")).toBeVisible();
    await capture("unlimited-approve-360.png");
    await rejectApproval();

    await openApproval(
      call(
        "setApprovalForAll(address,bool)",
        ["address", "bool"],
        [SPENDER, true],
      ),
      COLLECTION_CONTRACT,
    );
    await expect(
      extensionPage.getByText("Approve an operator for a whole collection"),
    ).toBeVisible();
    await expect(
      extensionPage.getByText("Quanta Relics (RELIC)"),
    ).toBeVisible();
    await expect(
      extensionPage.getByText(
        "This lets the operator move every NFT you hold in this collection, now and in the future.",
      ),
    ).toBeVisible();
    await expect(extensionPage.getByText("0xa22cb465")).toBeVisible();
    await capture("set-approval-for-all-360.png");
    await rejectApproval();

    // The same selector against a collection the wallet knows is an NFT
    // approval, and hands over that one item (security review finding M-1).
    await openApproval(
      call("approve(address,uint256)", ["address", "uint256"], [SPENDER, "1"]),
      COLLECTION_CONTRACT,
    );
    await expect(extensionPage.getByText("Approve one NFT")).toBeVisible();
    await expect(
      extensionPage.getByText("Token ID", { exact: true }),
    ).toBeVisible();
    await expect(
      extensionPage.getByText("Quanta Relics (RELIC)"),
    ).toBeVisible();
    await capture("approve-single-nft-360.png");
    await rejectApproval();

    // A selector the wallet does not know says so instead of inventing a
    // summary, and keeps the raw bytes one click away.
    await openApproval(`0xdeadbeef${"00".repeat(64)}`, TOKEN_CONTRACT);
    await expect(extensionPage.getByText("Contract interaction")).toBeVisible();
    await expect(extensionPage.getByText("0xdeadbeef")).toBeVisible();
    await expect(
      extensionPage.getByRole("button", { name: "Show raw data" }),
    ).toBeVisible();
    await rejectApproval();
  } finally {
    await context.close();
    await fixture.close();
  }
});
