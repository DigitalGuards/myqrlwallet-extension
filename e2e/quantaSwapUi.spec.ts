import {
  closeFixtureServer,
  fixtureTypedDataEncoder,
  hasFixtureAccount,
  installEthereumFixture,
  parseSignedFillIntent,
  readBody,
  readPendingRequest,
  readRpcBody,
  reportFixtureError,
  type DAppRequest,
  type ProtocolAuth,
  type SignedFillIntent,
  writeStorage,
} from "./fixtureHelpers";
import {
  chromium,
  expect,
  test,
  type Page,
  type Worker,
} from "@playwright/test";
import { sha256 } from "@noble/hashes/sha2";
import { shake256 } from "@noble/hashes/sha3.js";
import {
  CryptoBytes,
  CryptoPublicKeyBytes,
  CryptoSecretKeyBytes,
  cryptoSignKeypair,
  cryptoSignSignature,
} from "@theqrl/mldsa87";
import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { concatBytes, hexToBytes } from "../src/functions/pqSigning/bytes";
import { SCHEME_TAG_TYPED } from "../src/functions/pqSigning/ctx";
import {
  computeTypedDataDigest,
  type TypedDataPayload,
} from "../src/functions/pqSigning/typedData";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const EXTENSION_PATH = path.join(REPO_ROOT, "Extension");
const STORAGE_PREFIX =
  "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4";
const DAPPS_KEY = `${STORAGE_PREFIX}:DAPPS`;
const QUANTASWAP_FRONTEND_DIR = path.resolve(
  process.env.QUANTASWAP_FRONTEND_DIR ??
    path.join(REPO_ROOT, "..", "QuantaSwap", "frontend"),
);
const QUANTASWAP_DIST_DIR = path.join(QUANTASWAP_FRONTEND_DIR, "dist");

const frontendRequire = createRequire(
  path.join(QUANTASWAP_FRONTEND_DIR, "package.json"),
);
const TypedDataEncoder = fixtureTypedDataEncoder(frontendRequire("ethers"));

// Public deterministic fixture from canonical.json. Never fund this account.
const TEST_ONLY_HEX_SEED =
  "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";
const CHECKSUM_QRL_ACCOUNT =
  "Q6aFB7dFC849bC16E439033DfEE7B296484619Db8fc7e3b7c20a1b1688B128259338aFfd79b7cdda8F28509607bc26eB67a4799Ae457Ec82b57A6a57dea04C194";
const ETH_ACCOUNT = "0x2222222222222222222222222222222222222222";
const MAKER_ETH_ACCOUNT = "0x1111111111111111111111111111111111111111";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const ORDER_NONCE = `0x${"42".repeat(32)}`;
const MAKER_TOKEN = "11".repeat(32);
const DESCRIPTOR = new Uint8Array([1, 0, 0]);

const DOMAIN = {
  name: "QuantaSwap",
  version: "1",
  chainId: "1337",
  salt: "0x1ed0597b5e221ddfd0e541d33a5c14d663f5261645be67c4ee3a4be4d804a740",
} as const;

const DEPLOYMENT = {
  ethChainId: "11155111",
  ethHtlc: "eip155:11155111:0x910d5d4a7f2037c01f3b4c835167357e89909281",
  qrlChainId: "1337",
  // Historical v1 order verification intentionally retains its Q + 40
  // deployment fixture. The live QIP-55 signing request below must fail.
  qrlHtlc: "Q238322ad2e8f935b4481fcc379779c31b84decb0",
} as const;

interface TypedField {
  name: string;
  type: string;
}

const DOMAIN_FIELDS: readonly TypedField[] = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "salt", type: "bytes32" },
];

const ORDER_V1_FIELDS: readonly TypedField[] = [
  { name: "direction", type: "string" },
  { name: "asset", type: "string" },
  { name: "fromAmount", type: "uint256" },
  { name: "toAmount", type: "uint256" },
  { name: "makerEthAccount", type: "string" },
  { name: "makerQrlAccount", type: "string" },
  { name: "visibility", type: "string" },
  { name: "allowedTakerEth", type: "string" },
  { name: "allowedTakerQrl", type: "string" },
  { name: "prelocked", type: "bool" },
  { name: "hashlock", type: "bytes32" },
  { name: "initiatorTimeout", type: "uint64" },
  { name: "issuedAt", type: "uint64" },
  { name: "expiresAt", type: "uint64" },
  { name: "nonce", type: "bytes32" },
  { name: "makerTokenCommitment", type: "bytes32" },
  { name: "shareTokenCommitment", type: "bytes32" },
  { name: "ethChainId", type: "uint256" },
  { name: "ethHtlc", type: "string" },
  { name: "qrlChainId", type: "uint256" },
  { name: "qrlHtlc", type: "string" },
];

const FILL_INTENT_V1_FIELDS: readonly TypedField[] = [
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
];

interface MakerAuth extends ProtocolAuth {
  makerTokenCommitment: string;
  shareTokenCommitment: string;
}

interface PortableOrder {
  id: string;
  direction: "qrl->eth";
  asset: "ETH";
  fromAmount: string;
  toAmount: string;
  makerEthAccount: string;
  makerQrlAccount: string;
  visibility: "public";
  status: "open";
  takerEthAccount: null;
  takerQrlAccount: null;
  hashlock: null;
  initiatorTimeout: null;
  responderTimeout: null;
  released: false;
  makerSeen: true;
  prelocked: false;
  createdAt: number;
  updatedAt: number;
  makerAuth: MakerAuth;
  orderDigest: string;
}

const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString("hex")}`;

const makerTokenCommitment = (): string =>
  hex(
    sha256(
      concatBytes(
        new TextEncoder().encode("QuantaSwap Maker capability V1\0"),
        hexToBytes(`0x${MAKER_TOKEN}`),
      ),
    ),
  );

const orderId = (makerQrlAccount: string): string =>
  Buffer.from(
    sha256(
      concatBytes(
        new TextEncoder().encode("QuantaSwap OrderV1 id\0"),
        hexToBytes(`0x${makerQrlAccount.slice(1)}`),
        hexToBytes(ORDER_NONCE),
      ),
    ),
  ).toString("hex");

const makePortableOrder = (): PortableOrder => {
  const publicKey = new Uint8Array(CryptoPublicKeyBytes);
  const secretKey = new Uint8Array(CryptoSecretKeyBytes);
  cryptoSignKeypair(new Uint8Array(32).fill(7), publicKey, secretKey);
  const makerQrlAccount = `Q${Buffer.from(
    shake256(concatBytes(DESCRIPTOR, publicKey), { dkLen: 20 }),
  ).toString("hex")}`;
  const issuedAt = Math.floor(Date.now() / 1000) - 2;
  const expiresAt = issuedAt + 3600;
  const unsignedAuth = {
    version: "1" as const,
    scheme: "qrl-sign-typed-v1" as const,
    issuedAt,
    expiresAt,
    nonce: ORDER_NONCE,
    makerTokenCommitment: makerTokenCommitment(),
    shareTokenCommitment: ZERO_BYTES32,
    signature: "",
    publicKey: hex(publicKey),
    descriptor: hex(DESCRIPTOR),
  };
  const message = {
    direction: "qrl->eth",
    asset: "ETH",
    fromAmount: "2261250000000000000",
    toAmount: "1000000000000000",
    makerEthAccount: `eip155:11155111:${MAKER_ETH_ACCOUNT}`,
    makerQrlAccount,
    visibility: "public",
    allowedTakerEth: "",
    allowedTakerQrl: "",
    prelocked: false,
    hashlock: ZERO_BYTES32,
    initiatorTimeout: "0",
    issuedAt: String(issuedAt),
    expiresAt: String(expiresAt),
    nonce: ORDER_NONCE,
    makerTokenCommitment: unsignedAuth.makerTokenCommitment,
    shareTokenCommitment: ZERO_BYTES32,
    ...DEPLOYMENT,
  };
  const payload: TypedDataPayload = {
    types: {
      QRLDomain: [...DOMAIN_FIELDS],
      OrderV1: [...ORDER_V1_FIELDS],
    },
    primaryType: "OrderV1",
    domain: { ...DOMAIN },
    message,
  };
  const signature = new Uint8Array(CryptoBytes);
  cryptoSignSignature(
    signature,
    // OrderV1 has no address-typed field, so this is the v1 digest.
    computeTypedDataDigest(payload),
    secretKey,
    false,
    SCHEME_TAG_TYPED,
  );
  const digest = TypedDataEncoder.hash(
    DOMAIN,
    { OrderV1: ORDER_V1_FIELDS },
    message,
  );
  return {
    id: orderId(makerQrlAccount),
    direction: "qrl->eth",
    asset: "ETH",
    fromAmount: "2261250000000000000",
    toAmount: "1000000000000000",
    makerEthAccount: MAKER_ETH_ACCOUNT,
    makerQrlAccount,
    visibility: "public",
    status: "open",
    takerEthAccount: null,
    takerQrlAccount: null,
    hashlock: null,
    initiatorTimeout: null,
    responderTimeout: null,
    released: false,
    makerSeen: true,
    prelocked: false,
    createdAt: issuedAt,
    updatedAt: issuedAt,
    makerAuth: { ...unsignedAuth, signature: hex(signature) },
    orderDigest: digest,
  };
};

const writeJson = (
  response: ServerResponse,
  payload: unknown,
  status = 200,
): void => {
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
};

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
    case "qrl_blockNumber":
    case "eth_blockNumber":
      return "0x1";
    case "qrl_getBalance":
      return "0x0";
    case "web3_clientVersion":
      return "myqrlwallet-composition-e2e";
    default:
      return "0x0";
  }
};

const handleRpc = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  const body = await readRpcBody(request);
  const requests = Array.isArray(body) ? body : [body];
  const replies = requests.map(({ id, method }) => ({
    jsonrpc: "2.0",
    id: id ?? null,
    result: rpcResult(method),
  }));
  writeJson(response, Array.isArray(body) ? replies : replies[0]);
};

const intentMessage = (signed: SignedFillIntent): Record<string, unknown> => ({
  orderDigest: signed.intent.orderDigest,
  requestNonce: signed.auth.nonce,
  takerEthAccount: `eip155:11155111:${signed.intent.takerEthAccount}`,
  takerQrlAccount: signed.intent.takerQrlAccount,
  releaseCommitment: signed.intent.releaseCommitment,
  issuedAt: String(signed.auth.issuedAt),
  expiresAt: String(signed.auth.expiresAt),
  ...DEPLOYMENT,
});

const intentDigest = (signed: SignedFillIntent): string =>
  TypedDataEncoder.hash(
    DOMAIN,
    { FillIntentV1: FILL_INTENT_V1_FIELDS },
    intentMessage(signed),
  );

const contentType = (file: string): string => {
  switch (path.extname(file)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
};

const startFixtureServer = async (order: PortableOrder) => {
  if (!existsSync(path.join(QUANTASWAP_DIST_DIR, "index.html"))) {
    throw new Error(
      `Build QuantaSwap first: missing ${path.join(QUANTASWAP_DIST_DIR, "index.html")}`,
    );
  }
  const intentPosts: SignedFillIntent[] = [];
  const intentStatuses: number[] = [];
  const streamResponses = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://fixture.invalid");
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Origin": "*",
      });
      response.end();
      return;
    }
    if (
      request.method === "POST" &&
      ["/rpc/qrl", "/rpc/sepolia", "/rpc/sepolia-logs"].includes(
        requestUrl.pathname,
      )
    ) {
      handleRpc(request, response).catch((error: unknown) => {
        reportFixtureError(response, error);
      });
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/orders") {
      writeJson(response, { orders: [order] });
      return;
    }
    if (
      request.method === "GET" &&
      requestUrl.pathname === "/api/orders/stream"
    ) {
      response.writeHead(200, {
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
      });
      response.write(
        `event: book\ndata: ${JSON.stringify({ orders: [order] })}\n\n`,
      );
      streamResponses.add(response);
      request.on("close", () => streamResponses.delete(response));
      return;
    }
    if (
      request.method === "GET" &&
      requestUrl.pathname === `/api/orders/${order.id}`
    ) {
      writeJson(response, { order });
      return;
    }
    if (
      request.method === "POST" &&
      requestUrl.pathname === `/api/orders/${order.id}/intents`
    ) {
      readBody(request)
        .then((raw) => {
          const signed = parseSignedFillIntent(raw);
          intentPosts.push(signed);
          const status = intentPosts.length === 1 ? 201 : 200;
          intentStatuses.push(status);
          writeJson(
            response,
            {
              intent: {
                ...signed,
                intentDigest: intentDigest(signed),
                receivedAt: Math.floor(Date.now() / 1000),
              },
            },
            status,
          );
        })
        .catch((error: unknown) => {
          writeJson(
            response,
            { error: error instanceof Error ? error.message : String(error) },
            400,
          );
        });
      return;
    }

    if (request.method !== "GET") {
      writeJson(response, { error: "not found" }, 404);
      return;
    }
    const relative = decodeURIComponent(requestUrl.pathname).replace(
      /^\/+/,
      "",
    );
    const candidate = path.resolve(
      QUANTASWAP_DIST_DIR,
      relative || "index.html",
    );
    const safePrefix = `${path.resolve(QUANTASWAP_DIST_DIR)}${path.sep}`;
    const file =
      candidate.startsWith(safePrefix) &&
      existsSync(candidate) &&
      statSync(candidate).isFile()
        ? candidate
        : path.join(QUANTASWAP_DIST_DIR, "index.html");
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": file.endsWith("index.html")
        ? "text/html; charset=utf-8"
        : contentType(file),
    });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not bind TCP");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    intentPosts,
    intentStatuses,
    close: async () => {
      streamResponses.forEach((stream) => stream.end());
      await closeFixtureServer(server);
    },
  };
};

const waitForDAppRequest = async (
  serviceWorker: Worker,
  method: string,
): Promise<DAppRequest> => {
  await expect
    .poll(
      async () =>
        (await readPendingRequest(serviceWorker, DAPPS_KEY))?.method ?? null,
    )
    .toBe(method);
  const request = await readPendingRequest(serviceWorker, DAPPS_KEY);
  if (!request) throw new Error("Fixture dApp request unavailable");
  return request;
};

const approveCurrentRequest = async (extensionPage: Page): Promise<void> => {
  const yes = extensionPage.getByRole("button", { name: "Yes" });
  await expect(yes).toBeEnabled();
  await yes.click();
};

const onboardExtension = async (
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
  serviceWorker: Worker,
  extensionId: string,
): Promise<Page> => {
  let extensionPage = await context.newPage();
  await extensionPage.goto(
    `chrome-extension://${extensionId}/index.html?tab=true`,
  );
  await extensionPage.getByRole("button", { name: "Continue" }).click();
  await extensionPage
    .getByLabel("password", { exact: true })
    .fill("e2e-password-only");
  await extensionPage.getByLabel("reEnteredPassword").fill("e2e-password-only");
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
  const closed = extensionPage.waitForEvent("close");
  // Done closes the onboarding tab. The close can land while the click is
  // still settling, which Playwright reports as a closed target; that is
  // the expected outcome, so only a click on a still-open page may fail.
  await extensionPage
    .getByRole("button", { name: "Done" })
    .click({ noWaitAfter: true })
    .catch((error: unknown) => {
      if (!extensionPage.isClosed()) throw error;
    });
  await closed;
  await expect
    .poll(
      () =>
        hasFixtureAccount(serviceWorker, STORAGE_PREFIX, CHECKSUM_QRL_ACCOUNT),
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
  return extensionPage;
};

test("legacy QuantaSwap UI refuses a QIP-55 account before signing", async () => {
  const order = makePortableOrder();
  const fixture = await startFixtureServer(order);
  const profile = await mkdtemp(path.join(tmpdir(), "quantaswap-ui-e2e-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    ],
  });
  const lifecycleErrors: string[] = [];
  context.on("console", (message) => {
    const text = message.text();
    if (
      text.includes("StreamMiddleware - Unknown response id") ||
      text.includes("Provider already initialized") ||
      text.includes("Failed to get initial state")
    ) {
      lifecycleErrors.push(text);
    }
  });
  await context.addInitScript(installEthereumFixture, {
    ethAccount: ETH_ACCOUNT,
  });

  try {
    const workers: readonly (Worker | undefined)[] = context.serviceWorkers();
    let serviceWorker = workers[0];
    serviceWorker ??= await context.waitForEvent("serviceworker");
    const extensionId = new URL(serviceWorker.url()).host;
    await writeStorage(serviceWorker, "local", {
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
              rpcUrls: [`${fixture.origin}/rpc/qrl`],
              blockExplorerUrls: ["https://example.invalid"],
              nativeCurrency: {
                name: "Quanta",
                symbol: "Quanta",
                decimals: 18,
              },
              iconUrls: [],
              defaultRpcUrl: `${fixture.origin}/rpc/qrl`,
              defaultBlockExplorerUrl: "https://example.invalid",
              defaultIconUrl: "",
              isTestnet: true,
              defaultWsRpcUrl: `${fixture.origin}/rpc/qrl`,
              isCustomChain: true,
            },
          ],
        },
    });
    const extensionPage = await onboardExtension(
      context,
      serviceWorker,
      extensionId,
    );

    const quantaSwapPage = await context.newPage();
    await quantaSwapPage.goto(fixture.origin);
    await expect(
      quantaSwapPage.getByRole("heading", { name: /Atomic swaps for QRL/i }),
    ).toBeVisible();

    await quantaSwapPage.getByRole("button", { name: "ETH wallet" }).click();
    await expect(
      quantaSwapPage.getByTitle("View address on Etherscan"),
    ).toBeVisible();

    await quantaSwapPage.getByRole("button", { name: "QRL wallet" }).click();
    await quantaSwapPage
      .getByRole("button", { name: /MyQRLWallet Extension/ })
      .click();
    await waitForDAppRequest(serviceWorker, "qrl_requestAccounts");
    await approveCurrentRequest(extensionPage);
    await expect(
      quantaSwapPage.getByText(/Wallet returned an invalid QRL account/),
    ).toBeVisible();
    await expect(
      quantaSwapPage.getByTitle("View address on Zondscan"),
    ).toHaveCount(0);
    expect(fixture.intentPosts).toEqual([]);
    const pendingMethod =
      (await readPendingRequest(serviceWorker, DAPPS_KEY))?.method ?? null;
    expect(pendingMethod).not.toBe("qrl_signTypedData");
    expect(lifecycleErrors).toEqual([]);
  } finally {
    await context.close();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
  }
});
