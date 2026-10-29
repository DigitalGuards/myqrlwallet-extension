import vaultVectors from "../src/functions/pqSigning/__fixtures__/quantaVault/typed-data-v2.json" with { type: "json" };
import approvals from "../src/functions/pqSigning/__fixtures__/quantaVault/vault-approvals.json" with { type: "json" };
import {
  beginFixtureRequest,
  closeFixtureServer,
  hasFixtureProvider,
  isRequestDone,
  readRpcBody,
  reportFixtureError,
  writeStorage,
} from "./fixtureHelpers";
import { expect, test, chromium, type Page } from "@playwright/test";
import { createServer } from "node:http";
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

const startFixtureServer = async () => {
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/rpc") {
      (async () => {
        const body = await readRpcBody(request);
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
      })().catch((error: unknown) => {
        reportFixtureError(response, error);
      });
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
    close: () => closeFixtureServer(server),
  };
};

const beginRequest = async (page: Page, method: string, params: unknown[]) => {
  await page.evaluate(beginFixtureRequest, {
    stateKey: "requestState" as const,
    method,
    params,
    rawError: true,
  });
};

test("reviews contract calls and QuantaVault approvals at popup and side panel widths", async () => {
  test.setTimeout(240_000);
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
    await writeStorage(serviceWorker, "local", {
      [`${PROFILE}:SETTINGS`]: {
        sidePanelPreferred: false,
        phishingDetectionEnabled: false,
        autoLockMinutes: 30,
      },
      [`${PROFILE}:BLOCKCHAINS`]: {
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
    await writeStorage(serviceWorker, "local", {
      [`${PROFILE}:TOKENS`]: {
        ALL_TOKENS: {
          [CHECKSUM_ACCOUNT]: {
            "0x301825": {
              tokens: [
                {
                  address: TOKEN_CONTRACT,
                  symbol: "MQW",
                  decimals: 18,
                  image: "",
                },
              ],
            },
          },
        },
      },
      [`${PROFILE}:NFT_COLLECTIONS`]: {
        ALL_NFT_COLLECTIONS: {
          [CHECKSUM_ACCOUNT]: {
            "0x301825": {
              collections: [
                {
                  address: COLLECTION_CONTRACT,
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
      [`${PROFILE}:CONTACTS`]: {
        ALL_CONTACTS: [],
      },
    });

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
    await dAppPage.waitForFunction(hasFixtureProvider);

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
      await dAppPage.waitForFunction(isRequestDone, {
        stateKey: "requestState" as const,
      });
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
    // 500,000 gas x the signed ceiling (base fee 1 gwei doubled plus the
    // 1.5 gwei tip the market tier asks for).
    await expect(extensionPage.getByText("0.00175 Quanta")).toBeVisible();
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

    // An unknown selector receives a generic contract-interaction label
    // with its raw bytes one click away.
    await openApproval(`0xdeadbeef${"00".repeat(64)}`, TOKEN_CONTRACT);
    await expect(extensionPage.getByText("Contract interaction")).toBeVisible();
    await expect(extensionPage.getByText("0xdeadbeef")).toBeVisible();
    await expect(
      extensionPage.getByRole("button", { name: "Show raw data" }),
    ).toBeVisible();
    await rejectApproval();

    const base = vaultVectors.schemeVectors.find(
      (vector) => vector.label === "empty-call",
    );
    const approval = approvals.schemeVectors.find(
      (vector) => vector.label === "approval-empty",
    );
    if (!base || !approval) throw new Error("Missing vault vectors");
    const tx = {
      ...base.payload.message,
      to: TOKEN_CONTRACT,
      data: call(
        "approve(address,uint256)",
        ["address", "uint256"],
        [SPENDER, "1234500000000000000"],
      ),
      value: "1000000000000000001",
      operation: 0,
      txGas: "0",
      baseGas: "0",
      validUntil: MAX_UINT256.toString(),
    };
    const vaultPayload = {
      ...base.payload,
      domain: { ...base.payload.domain, chainId: "3151909" },
      message: tx,
    };
    const openVault = async (payload: unknown, canApprove: boolean) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await beginRequest(dAppPage, "qrl_signTypedData", [
          CHECKSUM_ACCOUNT,
          payload,
        ]);
        const visible = await extensionPage
          .getByRole("button", { name: "Yes", exact: true })
          .waitFor({ state: "visible", timeout: 6_000 })
          .then(() => true)
          .catch(() => false);
        if (visible) {
          if (canApprove)
            await expect(
              extensionPage.getByRole("button", { name: "Yes", exact: true }),
            ).toBeEnabled();
          else
            await expect(
              extensionPage.getByRole("button", { name: "Yes", exact: true }),
            ).toBeDisabled();
          return;
        }
        await extensionPage.waitForTimeout(APPROVAL_COOLDOWN_WAIT_MS);
      }
      throw new Error("Vault approval did not open");
    };

    await openVault(vaultPayload, true);
    await expect(
      extensionPage.getByText("Approve a vault transaction", { exact: true }),
    ).toBeVisible();
    await expect(
      extensionPage.getByText("1.2345 MQW", { exact: true }),
    ).toBeAttached();
    await expect(
      extensionPage.getByText("1.000000000000000001 Quanta", { exact: true }),
    ).toBeAttached();
    await expect(
      extensionPage.getByText(/browser-reported page origin/),
    ).toBeAttached();
    await expect(extensionPage.locator("details")).not.toHaveAttribute("open");

    await rejectApproval();
    // The action popup's existing intrinsic minimum is 368px. The panel
    // also exercises the review at 360px without changing the wallet shell.
    for (const { surface, width, height } of [
      { surface: "popup", width: 368, height: 600 },
      { surface: "panel", width: 360, height: 800 },
      { surface: "panel", width: 480, height: 800 },
    ]) {
      if (extensionPage.isClosed()) extensionPage = await context.newPage();
      await extensionPage.setViewportSize({ width, height });
      await extensionPage.goto(
        `chrome-extension://${extensionId}/index.html${surface === "panel" ? "?sidepanel=true" : ""}`,
      );
      await expect(
        extensionPage.getByRole("heading", { name: "Active account" }),
      ).toBeVisible();
      await openVault(vaultPayload, true);
      for (const theme of ["dark", "light"]) {
        await extensionPage.evaluate(
          (dark) => document.documentElement.classList.toggle("dark", dark),
          theme === "dark",
        );
        const review = extensionPage.getByTestId("vault-review");
        await expect(review).toBeVisible();
        await review.scrollIntoViewIfNeeded();
        const layout = await review.evaluate((element) => ({
          scrolls: element.scrollHeight > element.clientHeight,
          fits: element.scrollWidth <= element.clientWidth,
          viewportFits:
            document.documentElement.scrollWidth <= window.innerWidth,
        }));
        expect(layout).toEqual({
          scrolls: true,
          fits: true,
          viewportFits: true,
        });
        await capture(`vault-${surface}-${width}-${theme}.png`);
        await review.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
        await expect(
          extensionPage.getByText("Refund receiver", { exact: true }),
        ).toBeVisible();
        await capture(`vault-${surface}-${width}-${theme}-refund.png`);
        await review.evaluate((element) => {
          element.scrollTop = 0;
        });
      }
      await extensionPage
        .getByText("Raw message JSON", { exact: true })
        .click();
      await expect(extensionPage.locator("details")).toHaveAttribute("open");
      await expect(extensionPage.locator("details")).toContainText('"nonce"');
      await rejectApproval();
    }

    // Reuse the mounted side panel across a blocked request and its clean successor.
    await openVault(
      { ...vaultPayload, message: { ...tx, baseGas: "1" } },
      false,
    );
    await expect(
      extensionPage.getByText(/Refund fields must be zero/),
    ).toBeAttached();
    await rejectApproval();
    const nested = {
      ...approval.payload,
      domain: { ...approval.payload.domain, chainId: "0x301825" },
      message: { ...approval.payload.message, tx: { ...tx, gasPrice: "1" } },
    };
    await openVault(nested, false);
    await expect(
      extensionPage.getByText("On behalf of outer vault", { exact: true }),
    ).toBeAttached();
    await rejectApproval();

    const packedEntry = `00${TOKEN_CONTRACT.slice(1)}${"0".repeat(128)}${BigInt(
      (tx.data.length - 2) / 2,
    )
      .toString(16)
      .padStart(128, "0")}${tx.data.slice(2)}`;
    const batch = {
      ...vaultPayload,
      message: {
        ...tx,
        operation: 1,
        data: call(
          "multiSend(bytes)",
          ["bytes"],
          [`0x${packedEntry.repeat(12)}`],
        ),
      },
    };
    await openVault(batch, true);
    await expect(
      extensionPage.getByText(/full control of the vault/),
    ).toBeAttached();
    const review = extensionPage.getByTestId("vault-review");
    await review.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      extensionPage.getByText("Enclosed call 12", { exact: true }),
    ).toBeAttached();
    await expect(
      extensionPage.getByText("Refund receiver", { exact: true }),
    ).toBeVisible();
    expect(
      await review.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await capture("vault-long-batch-panel.png");
    await rejectApproval();
  } finally {
    await context.close();
    await fixture.close();
  }
});
