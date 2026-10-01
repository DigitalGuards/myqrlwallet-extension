import { expect, test, chromium } from "@playwright/test";
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
const PROFILE_PREFIX =
  "v3:0x301825:0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4:";

type MethodProbe = {
  isConnected?: unknown;
  isConnectedError?: string;
  destructuredIsConnected?: unknown;
  destructuredError?: string;
  chainIdGetter?: unknown;
  sameFunctionOnEveryRead?: boolean;
  listenerEvents?: string[];
  afterRemoveEvents?: string[];
  listenerError?: string;
  blockNumber?: unknown;
  requestError?: string;
};

type AnnouncedProvider = {
  isConnected: () => boolean;
  chainId: string | null;
};

type ProbeWindow = Window & { probe?: MethodProbe };
type ProviderWindow = Window & { qrlProvider?: AnnouncedProvider };

// Exercises the announced provider the way a dApp library does: call the
// public methods, destructure them, hold on to a listener and take it off
// again. The vendored package announces a Proxy that returns its methods
// unbound, so every one of these used to throw
// "TypeError: Cannot read from private field".
const dAppHtml = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>provider method fixture</title></head>
  <body>
    <h1>provider method fixture</h1>
    <script>
      window.probe = {};
      window.addEventListener("eip6963:announceProvider", (event) => {
        if (event.detail.info.rdns !== "com.qrlwallet.extension") return;
        const provider = event.detail.provider;
        window.qrlProvider = provider;

        try {
          window.probe.isConnected = provider.isConnected();
        } catch (error) {
          window.probe.isConnectedError = String(error && error.message || error);
        }

        try {
          const { isConnected } = provider;
          window.probe.destructuredIsConnected = isConnected();
        } catch (error) {
          window.probe.destructuredError = String(error && error.message || error);
        }

        window.probe.sameFunctionOnEveryRead =
          provider.isConnected === provider.isConnected;

        try {
          const events = [];
          window.probe.listenerEvents = events;
          const listener = (chainId) => { events.push(String(chainId)); };
          provider.on("chainChanged", listener);
          provider.emit("chainChanged", "0x1");
          provider.removeListener("chainChanged", listener);
          provider.emit("chainChanged", "0x2");
          window.probe.afterRemoveEvents = events.slice();
        } catch (error) {
          window.probe.listenerError = String(error && error.message || error);
        }

        provider
          .request({ method: "qrl_blockNumber" })
          .then((result) => {
            window.probe.blockNumber = result;
          })
          .catch((error) => {
            window.probe.requestError = String(error && error.message || error);
          });
      });
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    </script>
  </body>
</html>`;

const rpcResult = (method: string): unknown => {
  switch (method) {
    case "qrl_blockNumber":
      return "0x1";
    case "qrl_chainId":
      return "0x301825";
    case "net_version":
      return "3151909";
    case "net_listening":
      return true;
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
) => {
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
  response.end(JSON.stringify(Array.isArray(body) ? results : results[0]));
};

const startFixtureServer = async () => {
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/rpc") {
      void handleRpc(request, response);
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
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

test("every public method on the announced provider is callable", async () => {
  const fixture = await startFixtureServer();
  const profile = await mkdtemp(path.join(tmpdir(), "myqrlwallet-binding-"));
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

    await serviceWorker.evaluate(
      async ({ rpcUrl, prefix }) => {
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
        });
      },
      { rpcUrl: `${fixture.origin}/rpc`, prefix: PROFILE_PREFIX },
    );

    const dAppPage = await context.newPage();
    await dAppPage.goto(fixture.origin);
    await dAppPage.waitForFunction(
      () =>
        (window as ProbeWindow).probe?.sameFunctionOnEveryRead !== undefined,
    );
    await dAppPage.waitForFunction(() => {
      const probe = (window as ProbeWindow).probe;
      return (
        probe?.blockNumber !== undefined || probe?.requestError !== undefined
      );
    });

    const probe = (await dAppPage.evaluate(
      () => (window as ProbeWindow).probe,
    )) as MethodProbe;

    // Called the moment the provider was announced, before its initial
    // state landed, so the answer is false; the point is that it answered
    // at all. Unfixed, this threw "Cannot read from private field".
    expect(probe.isConnectedError).toBeUndefined();
    expect(probe.isConnected).toBe(false);

    expect(probe.destructuredError).toBeUndefined();
    expect(probe.destructuredIsConnected).toBe(false);

    expect(probe.sameFunctionOnEveryRead).toBe(true);

    expect(probe.listenerError).toBeUndefined();
    // on() delivered the first emit and removeListener() stopped the
    // second, so both ran against the real provider.
    expect(probe.afterRemoveEvents).toEqual(["0x1"]);

    expect(probe.requestError).toBeUndefined();
    expect(probe.blockNumber).toBe("0x1");

    // And the same calls once the provider has its initial state, which is
    // when a dApp would ask.
    await dAppPage.waitForFunction(
      () => (window as ProviderWindow).qrlProvider?.chainId !== null,
    );
    const whenReady = await dAppPage.evaluate(() => {
      const provider = (window as ProviderWindow).qrlProvider;
      if (!provider) return { error: "no provider" };
      try {
        return {
          isConnected: provider.isConnected(),
          chainId: provider.chainId,
        };
      } catch (error) {
        return { error: String((error as Error)?.message ?? error) };
      }
    });

    expect(whenReady).toEqual({ isConnected: true, chainId: "0x301825" });
  } finally {
    await context.close();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
  }
});
