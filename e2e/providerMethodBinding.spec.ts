import { isRecord } from "../src/utilities/storageGuards";
import {
  beginFixtureRequest,
  closeFixtureServer,
  fixtureRequestResult,
  readProviderProperty,
  readRpcBody,
  readWindowValue,
  reportFixtureError,
  writeStorage,
} from "./fixtureHelpers";
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

test("fixture requests settle promises from a same-origin iframe once", async () => {
  const browser = await chromium.launch({
    channel: "chromium",
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(`<iframe srcdoc="<script>
      window.result = Promise.resolve('0x1');
      window.request = ({ method }) => method === 'qrl_blockNumber'
        ? window.result
        : Promise.reject({ code: 4001, message: 'rejected' });
    </script>"></iframe>`);
    const sameRealm = await page.evaluate(() => {
      const frame = document.querySelector("iframe")?.contentWindow;
      if (!frame) throw new Error("Fixture frame unavailable");
      const request: unknown = Reflect.get(frame, "request");
      const result: unknown = Reflect.get(frame, "result");
      Object.assign(window, {
        qrlProvider: { request },
        trackedRequestStates: {},
        trackedRequestSettlements: {},
      });
      return result instanceof Promise;
    });
    expect(sameRealm).toBe(false);
    for (const method of ["qrl_blockNumber", "qrl_requestAccounts"]) {
      const location = {
        stateKey: "trackedRequestStates" as const,
        requestKey: method,
      };
      await page.evaluate(beginFixtureRequest, {
        ...location,
        settlementsKey: "trackedRequestSettlements" as const,
        method,
      });
      if (method === "qrl_blockNumber") {
        await expect(fixtureRequestResult(page, location)).resolves.toBe("0x1");
      } else {
        await expect(fixtureRequestResult(page, location)).rejects.toThrow(
          "RPC 4001: rejected",
        );
      }
    }
    expect(
      await page.evaluate(readWindowValue, "trackedRequestSettlements"),
    ).toEqual({
      qrl_blockNumber: 1,
      qrl_requestAccounts: 1,
    });
  } finally {
    await browser.close();
  }
});

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

const handleRpc = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
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
  response.end(JSON.stringify(Array.isArray(body) ? results : results[0]));
};

const startFixtureServer = async () => {
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/rpc") {
      handleRpc(request, response).catch((error: unknown) => {
        reportFixtureError(response, error);
      });
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
    close: () => closeFixtureServer(server),
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

    await writeStorage(serviceWorker, "local", {
      [`${PROFILE_PREFIX}SETTINGS`]: {
        sidePanelPreferred: true,
        phishingDetectionEnabled: false,
        autoLockMinutes: 30,
      },
      [`${PROFILE_PREFIX}BLOCKCHAINS`]: {
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

    const dAppPage = await context.newPage();
    await dAppPage.goto(fixture.origin);
    await dAppPage.waitForFunction(() => {
      const probe: unknown = Reflect.get(window, "probe");
      return (
        typeof probe === "object" &&
        probe !== null &&
        "sameFunctionOnEveryRead" in probe &&
        probe.sameFunctionOnEveryRead !== undefined
      );
    });
    await dAppPage.waitForFunction(() => {
      const probe: unknown = Reflect.get(window, "probe");
      return (
        typeof probe === "object" &&
        probe !== null &&
        (("blockNumber" in probe && probe.blockNumber !== undefined) ||
          ("requestError" in probe && probe.requestError !== undefined))
      );
    });

    const probe = await dAppPage.evaluate(readWindowValue, "probe");
    if (!isRecord(probe)) throw new Error("Provider probe unavailable");

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
    await expect
      .poll(() => dAppPage.evaluate(readProviderProperty, "chainId"))
      .toBe("0x301825");
    const whenReady = await dAppPage.evaluate(() => {
      const provider: unknown = Reflect.get(window, "qrlProvider");
      const isProvider = (
        value: unknown,
      ): value is {
        isConnected: () => unknown;
        chainId: unknown;
      } =>
        typeof value === "object" &&
        value !== null &&
        "isConnected" in value &&
        typeof value.isConnected === "function" &&
        "chainId" in value;
      if (!isProvider(provider)) return { error: "no provider" };
      try {
        return {
          isConnected: provider.isConnected(),
          chainId: provider.chainId,
        };
      } catch (error: unknown) {
        return {
          error:
            typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof error.message === "string"
              ? error.message
              : String(error),
        };
      }
    });

    expect(whenReady).toEqual({ isConnected: true, chainId: "0x301825" });
  } finally {
    await context.close();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
  }
});
