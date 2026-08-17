import {
  chromium,
  expect,
  test,
  type Page,
  type Worker,
} from "@playwright/test";
import { sha256 } from "@noble/hashes/sha256";
import { shake256 } from "@noble/hashes/sha3.js";
import {
  CryptoBytes,
  CryptoPublicKeyBytes,
  CryptoSecretKeyBytes,
  cryptoSignKeypair,
  cryptoSignSignature,
  cryptoSignVerify,
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
import {
  bytesToHex,
  concatBytes,
  hexToBytes,
} from "../src/functions/pqSigning/bytes";
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
const QUANTASWAP_FRONTEND_DIR = path.resolve(
  process.env.QUANTASWAP_FRONTEND_DIR ??
    path.join(REPO_ROOT, "..", "QuantaSwap", "frontend"),
);
const QUANTASWAP_DIST_DIR = path.join(QUANTASWAP_FRONTEND_DIR, "dist");

const frontendRequire = createRequire(
  path.join(QUANTASWAP_FRONTEND_DIR, "package.json"),
);
const { TypedDataEncoder } = frontendRequire("ethers") as {
  TypedDataEncoder: {
    hash(
      domain: Record<string, unknown>,
      types: Record<string, readonly TypedField[]>,
      value: Record<string, unknown>,
    ): string;
  };
};

// Public deterministic fixture from canonical.json. Never fund this account.
const TEST_ONLY_HEX_SEED =
  "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";
const CHECKSUM_QRL_ACCOUNT = "Q6afB7Dfc849bC16E439033dfee7B296484619Db8";
const CANONICAL_QRL_ACCOUNT = `Q${CHECKSUM_QRL_ACCOUNT.slice(1).toLowerCase()}`;
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

interface ProtocolAuth {
  version: "1";
  scheme: "qrl-sign-typed-v1";
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  signature: string;
  publicKey: string;
  descriptor: string;
}

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

interface FillIntentBody {
  orderDigest: string;
  takerEthAccount: string;
  takerQrlAccount: string;
  releaseCommitment: string;
}

interface SignedFillIntent {
  intent: FillIntentBody;
  auth: ProtocolAuth;
}

interface DAppRequest {
  method: string;
  params?: unknown[];
  requestId?: string;
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

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
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
    case "qrl_chainId":
      return "0x539";
    case "net_version":
      return "1337";
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
  const body = JSON.parse(await readBody(request)) as
    | { id?: string | number; method: string }
    | Array<{ id?: string | number; method: string }>;
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
      void handleRpc(request, response);
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
      void readBody(request)
        .then((raw) => {
          const signed = JSON.parse(raw) as SignedFillIntent;
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
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

const waitForDAppRequest = async (
  serviceWorker: Worker,
  method: string,
): Promise<DAppRequest> => {
  await expect
    .poll(() =>
      serviceWorker.evaluate(async () => {
        const stored = await chrome.storage.session.get("DAPPS");
        return stored.DAPPS?.DAPPS_REQUEST_DATA?.method ?? null;
      }),
    )
    .toBe(method);
  return serviceWorker.evaluate(async () => {
    const stored = await chrome.storage.session.get("DAPPS");
    return stored.DAPPS?.DAPPS_REQUEST_DATA as DAppRequest;
  });
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
  await extensionPage.getByRole("button", { name: "Done" }).click();
  await closed;
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
          const expected = expectedAccount.toLowerCase();
          return (
            keystores.some(
              ({ address }) => address?.toLowerCase() === expected,
            ) &&
            ACCOUNTS?.ALL_ACCOUNTS?.some(
              (account: string) => account.toLowerCase() === expected,
            )
          );
        }, CHECKSUM_QRL_ACCOUNT),
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

test("real QuantaSwap UI connects and submits an authenticated FillIntentV1", async () => {
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
  await context.addInitScript(
    ({ ethAccount }) => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const provider = {
        request: async ({ method }: { method: string }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") {
            return [ethAccount];
          }
          if (method === "eth_chainId") return "0xaa36a7";
          if (method === "net_version") return "11155111";
          return null;
        },
        on: (event: string, listener: (...args: unknown[]) => void) => {
          const handlers = listeners.get(event) ?? new Set();
          handlers.add(listener);
          listeners.set(event, handlers);
        },
        removeListener: (
          event: string,
          listener: (...args: unknown[]) => void,
        ) => {
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
    },
    { ethAccount: ETH_ACCOUNT },
  );

  try {
    let serviceWorker = context.serviceWorkers()[0];
    serviceWorker ??= await context.waitForEvent("serviceworker");
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
      { rpcUrl: `${fixture.origin}/rpc/qrl` },
    );
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
      quantaSwapPage.getByTitle("View address on Zondscan"),
    ).toBeVisible();

    const orderRow = quantaSwapPage.getByTitle(/^Take:/);
    await expect(orderRow).toBeVisible();
    await orderRow.click();
    await expect(
      quantaSwapPage.getByText(
        "Maker's portable OrderV1 signature verified in this browser.",
      ),
    ).toBeVisible();
    await quantaSwapPage
      .getByRole("button", { name: "Sign fill request" })
      .click();

    const signingRequest = await waitForDAppRequest(
      serviceWorker,
      "qrl_signTypedData",
    );
    const signingParams = signingRequest.params ?? [];
    const requestedSigner = signingParams[0];
    const payload = signingParams[1] as TypedDataPayload;
    expect(requestedSigner).toBe(CANONICAL_QRL_ACCOUNT);
    expect(payload.primaryType).toBe("FillIntentV1");
    expect(payload.domain).toEqual(DOMAIN);
    expect(payload.message).toMatchObject({
      orderDigest: order.orderDigest,
      takerEthAccount: `eip155:11155111:${ETH_ACCOUNT}`,
      takerQrlAccount: CANONICAL_QRL_ACCOUNT,
      ...DEPLOYMENT,
    });
    await expect(
      extensionPage.getByText("QuantaSwap · FillIntentV1"),
    ).toBeVisible();
    await approveCurrentRequest(extensionPage);

    await expect
      .poll(() => fixture.intentPosts.length, { timeout: 60_000 })
      .toBeGreaterThanOrEqual(1);
    const submitted = fixture.intentPosts[0];
    expect(submitted).toBeDefined();
    expect(fixture.intentStatuses[0]).toBe(201);
    expect(submitted?.intent).toEqual({
      orderDigest: order.orderDigest,
      takerEthAccount: ETH_ACCOUNT,
      takerQrlAccount: CANONICAL_QRL_ACCOUNT,
      releaseCommitment: payload.message.releaseCommitment,
    });
    expect(submitted?.auth).toMatchObject({
      version: "1",
      scheme: "qrl-sign-typed-v1",
      nonce: payload.message.requestNonce,
      issuedAt: Number(payload.message.issuedAt),
      expiresAt: Number(payload.message.expiresAt),
    });
    expect(intentMessage(submitted as SignedFillIntent)).toEqual(
      payload.message,
    );
    const typedDigest = computeTypedDataDigest(payload);
    expect(
      cryptoSignVerify(
        hexToBytes(submitted?.auth.signature ?? ""),
        typedDigest,
        hexToBytes(submitted?.auth.publicKey ?? ""),
        SCHEME_TAG_TYPED,
      ),
    ).toBe(true);
    const derivedSigner = `Q${bytesToHex(
      shake256(
        concatBytes(
          hexToBytes(submitted?.auth.descriptor ?? ""),
          hexToBytes(submitted?.auth.publicKey ?? ""),
        ),
        { dkLen: 20 },
      ),
    ).slice(2)}`;
    expect(derivedSigner).toBe(CANONICAL_QRL_ACCOUNT);

    await expect(
      quantaSwapPage.getByRole("heading", { name: "Fill request signed" }),
    ).toBeVisible();
    const persisted = await quantaSwapPage.evaluate(() =>
      JSON.parse(localStorage.getItem("quantaswap.swap.v2") ?? "null"),
    );
    expect(persisted.intent).toEqual(submitted);
    expect(persisted.orderDigest).toBe(order.orderDigest);
    expect(persisted.takerQrlAccount).toBe(CHECKSUM_QRL_ACCOUNT);

    const postsBeforeReload = fixture.intentPosts.length;
    await quantaSwapPage.reload();
    await expect(
      quantaSwapPage.getByRole("heading", { name: "Fill request signed" }),
    ).toBeVisible();
    await expect
      .poll(() => fixture.intentPosts.length)
      .toBeGreaterThan(postsBeforeReload);
    for (const replay of fixture.intentPosts) {
      expect(replay).toEqual(submitted);
    }
    expect(
      fixture.intentStatuses.slice(1).every((status) => status === 200),
    ).toBe(true);
    expect(lifecycleErrors).toEqual([]);
  } finally {
    await context.close();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
  }
});
