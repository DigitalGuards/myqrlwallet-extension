import { chromium, expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import de from "../src/i18n/locales/de.json" with { type: "json" };
import en from "../src/i18n/locales/en.json" with { type: "json" };
import es from "../src/i18n/locales/es.json" with { type: "json" };
import ru from "../src/i18n/locales/ru.json" with { type: "json" };
import zhCN from "../src/i18n/locales/zh-CN.json" with { type: "json" };
import {
  beginFixtureRequest,
  closeFixtureServer,
  hasFixtureProvider,
  isRequestDone,
  readRpcBody,
  readStoredValue,
  reportFixtureError,
  writeStorage,
} from "./fixtureHelpers";

const EXTENSION_PATH = fileURLToPath(new URL("../Extension", import.meta.url));
const POPUP_SIZE = { width: 368, height: 600 };
const GENESIS =
  "0xd15407991193e6c23b733dc6bf9c628deaff8f9b6e252aa0d60030952b3e3ea4";
const SETTINGS_KEY = `v3:0x301825:${GENESIS}:SETTINGS`;
// Public deterministic fixture from canonical.json. Never fund this account.
const TEST_ONLY_HEX_SEED =
  "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";

const rpcResult = (method: string): unknown => {
  switch (method) {
    case "qrl_getBlockByNumber":
      return { hash: GENESIS };
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
    default:
      return "0x0";
  }
};

const startFixture = async () => {
  const server = createServer((request, response) => {
    if (request.method === "POST" && request.url === "/rpc") {
      (async () => {
        const body = await readRpcBody(request);
        const requests = Array.isArray(body) ? body : [body];
        const results = requests.map(({ id, method }) => ({
          jsonrpc: "2.0",
          id: id ?? null,
          result: rpcResult(method),
        }));
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        });
        response.end(
          JSON.stringify(Array.isArray(body) ? results : results[0]),
        );
      })().catch((error: unknown) => {
        reportFixtureError(response, error);
      });
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>Wallet language fixture</title></head>
      <body><h1>Wallet language fixture</h1><script>
      window.addEventListener("eip6963:announceProvider", (event) => {
        if (event.detail.info.rdns === "com.qrlwallet.extension") {
          window.qrlProvider = event.detail.provider;
        }
      });
      window.dispatchEvent(new Event("eip6963:requestProvider"));
      </script></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture did not bind TCP");
  return {
    origin: `http://localhost:${address.port}`,
    close: () => closeFixtureServer(server),
  };
};

const openPreferences = async (page: Page, copy: typeof en) => {
  await page.getByTestId("ellipsis-icon").click();
  await page
    .getByRole("menuitem", { name: copy["header.settings"], exact: true })
    .click();
  await page
    .getByRole("button", { name: copy["settings.preferences"], exact: true })
    .click();
};

const expectPopupLayout = async (page: Page) => {
  const layout = await page.evaluate(() => {
    const root = document.querySelector('[role="dialog"]') ?? document.body;
    const tolerance = 0.5;
    const outsideViewport = [root, ...root.querySelectorAll("*")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        // Screen-reader text is intentionally clipped out of the visual layout.
        return (
          element.checkVisibility() &&
          style.visibility === "visible" &&
          style.getPropertyValue("clip") === "auto" &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        // Import forms scroll vertically. Modal contents must fit both axes.
        return rect.left < -tolerance ||
          rect.right > innerWidth + tolerance ||
          (root !== document.body &&
            (rect.top < -tolerance || rect.bottom > innerHeight + tolerance))
          ? [
              {
                tag: element.tagName,
                text: element.textContent.slice(0, 80),
                left: rect.left,
                right: rect.right,
                top: rect.top,
                bottom: rect.bottom,
              },
            ]
          : [];
      });
    const tabs = [...root.querySelectorAll('[role="tab"]')].map((tab) => {
      const bounds = tab.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(tab);
      const lines = [...range.getClientRects()];
      return {
        text: tab.textContent,
        lines: new Set(lines.map((line) => line.top)).size,
        overflows:
          tab.scrollWidth > tab.clientWidth + 1 ||
          tab.scrollHeight > tab.clientHeight + 1 ||
          lines.some(
            (line) =>
              line.left < bounds.left - tolerance ||
              line.right > bounds.right + tolerance ||
              line.top < bounds.top - tolerance ||
              line.bottom > bounds.bottom + tolerance,
          ),
      };
    });
    return { outsideViewport, tabs };
  });
  expect
    .soft(layout.outsideViewport, "Elements must fit the popup viewport")
    .toEqual([]);
  for (const tab of layout.tabs) {
    expect.soft(tab.overflows, `Tab label must fit: ${tab.text}`).toBe(false);
    expect
      .soft(tab.lines, `Tab label must use at most two lines: ${tab.text}`)
      .toBeLessThanOrEqual(2);
  }
};

for (const { language, label, copy } of [
  { language: "en", label: "English", copy: en },
  { language: "es", label: "Español", copy: es },
  { language: "de", label: "Deutsch", copy: de },
  { language: "ru", label: "Русский", copy: ru },
  { language: "zh-CN", label: "简体中文", copy: zhCN },
]) {
  test(`${language} persists, fits import and reset layouts, and translates approvals`, async () => {
    const fixture = await startFixture();
    const profile = await mkdtemp(path.join(tmpdir(), "wallet-language-"));
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      viewport: POPUP_SIZE,
      colorScheme: "dark",
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost",
      ],
    });
    try {
      const worker =
        context.serviceWorkers()[0] ??
        (await context.waitForEvent("serviceworker"));
      const extensionId = new URL(worker.url()).host;
      const popupUrl = `chrome-extension://${extensionId}/index.html`;
      const settings = {
        language: "en",
        themePreference: "dark",
        sidePanelSurface: "popup",
        sidePanelPreferred: false,
        phishingDetectionEnabled: false,
        showBalanceAndPrice: false,
        autoLockMinutes: 30,
      };
      await writeStorage(worker, "local", {
        [SETTINGS_KEY]: settings,
        [`v3:0x301825:${GENESIS}:BLOCKCHAINS`]: {
          ACTIVE_BLOCKCHAIN: "0x301825",
          ALL_BLOCKCHAINS: [
            {
              chainId: "0x301825",
              chainName: "QRL fixture",
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
              defaultWsRpcUrl: `${fixture.origin}/rpc`,
              isTestnet: true,
              isCustomChain: true,
            },
          ],
        },
      });

      const onboarding = await context.newPage();
      await onboarding.goto(`${popupUrl}?tab=true`);
      await onboarding.getByRole("button", { name: "Continue" }).click();
      await onboarding
        .getByLabel("password", { exact: true })
        .fill("e2e-password-only");
      await onboarding
        .getByLabel("reEnteredPassword")
        .fill("e2e-password-only");
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
      const closed = onboarding.waitForEvent("close");
      await onboarding
        .getByRole("button", { name: "Done" })
        .click({ noWaitAfter: true })
        .catch((error: unknown) => {
          if (!onboarding.isClosed()) throw error;
        });
      await closed;

      const popup = await context.newPage();
      await popup.goto(popupUrl);
      await expect(
        popup.getByRole("heading", { name: en["home.activeAccount"] }),
      ).toBeVisible();
      await openPreferences(popup, en);
      await popup
        .getByRole("combobox", { name: "Language", exact: true })
        .click();
      await expect(popup.getByRole("option")).toHaveText([
        "English",
        "Español",
        "Deutsch",
        "Русский",
        "简体中文",
      ]);
      await popup.getByRole("option", { name: label, exact: true }).click();
      await expect(
        popup.getByRole("combobox", {
          name: copy["settings.preferences.languageLabel"],
          exact: true,
        }),
      ).toHaveText(label);
      await expect
        .poll(() => readStoredValue(worker, "local", SETTINGS_KEY))
        .toMatchObject({ language });
      await popup.reload();
      await expect(
        popup.getByRole("combobox", {
          name: copy["settings.preferences.languageLabel"],
          exact: true,
        }),
      ).toHaveText(label);
      await popup.getByRole("link", { name: "MyQRLWallet Logo" }).click();
      await expect(
        popup.getByRole("heading", { name: copy["home.activeAccount"] }),
      ).toBeVisible();
      await expect(
        popup.getByRole("link", { name: copy["home.send"], exact: true }),
      ).toBeVisible();

      const capture = async (screen: string) => {
        await popup.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            document
              .getAnimations()
              .filter(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations !== Infinity,
              )
              .map((animation) => animation.finished),
          );
        });
        expect(popup.viewportSize()).toEqual(POPUP_SIZE);
        expect(
          await popup.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(POPUP_SIZE.width);
        const directory = process.env.I18N_SHOT_DIR;
        if (directory) {
          await mkdir(directory, { recursive: true });
          await popup.screenshot({
            path: path.join(directory, `${language}-${screen}.png`),
            animations: "disabled",
          });
        }
      };
      await capture("home");
      await popup
        .getByRole("link", { name: copy["home.importAccount"], exact: true })
        .click();
      for (const { name, screen } of [
        { name: copy["importAccount.tabMnemonic"], screen: "import-mnemonic" },
        { name: copy["importAccount.tabHexSeed"], screen: "import-hex" },
        { name: copy["importAccount.tabWalletFile"], screen: "import-file" },
      ]) {
        const tab = popup.getByRole("tab", { name, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(tab).toBeInViewport({ ratio: 1 });
        await expect(popup.getByRole("tab")).toHaveCount(3);
        await capture(screen);
        await expectPopupLayout(popup);
      }
      await popup.getByRole("link", { name: "MyQRLWallet Logo" }).click();
      await popup.getByTestId("ellipsis-icon").click();
      await popup
        .getByRole("menuitem", { name: copy["header.settings"], exact: true })
        .click();
      await popup
        .getByRole("button", { name: copy["settings.data"], exact: true })
        .click();
      await popup
        .getByRole("button", {
          name: copy["settings.data.resetButton"],
          exact: true,
        })
        .click();
      const resetDialog = popup.getByRole("dialog", {
        name: copy["resetWallet.title"],
        exact: true,
      });
      await expect(resetDialog).toBeVisible();
      const resetButton = resetDialog.getByRole("button", {
        name: copy["resetWallet.confirmButton"],
        exact: true,
      });
      await expect(resetButton).toBeDisabled();
      await capture("reset-dialog");
      await expectPopupLayout(popup);
      await resetDialog
        .getByRole("textbox")
        .fill(copy["resetWallet.confirmWord"]);
      await expect(resetButton).toBeEnabled();
      await expectPopupLayout(popup);
      await resetDialog
        .getByRole("button", { name: copy["common.cancel"], exact: true })
        .click();
      await expect(resetDialog).toBeHidden();
      await popup.getByRole("link", { name: "MyQRLWallet Logo" }).click();
      await openPreferences(popup, copy);
      await popup
        .getByRole("combobox", {
          name: copy["settings.preferences.languageLabel"],
          exact: true,
        })
        .click();
      await expect(popup.getByRole("option")).toHaveText([
        "English",
        "Español",
        "Deutsch",
        "Русский",
        "简体中文",
      ]);
      await capture("languages");
      await popup.keyboard.press("Escape");
      await popup.getByRole("link", { name: "MyQRLWallet Logo" }).click();
      await expect(
        popup.getByRole("heading", { name: copy["home.activeAccount"] }),
      ).toBeVisible();

      const dapp = await context.newPage();
      await dapp.goto(fixture.origin);
      await dapp.waitForFunction(hasFixtureProvider);
      await dapp.evaluate(beginFixtureRequest, {
        stateKey: "requestState" as const,
        method: "qrl_requestAccounts",
        params: [],
      });
      await expect(
        popup.getByText(copy["dapp.permissionTitle"], { exact: true }),
      ).toBeVisible();
      // These existing accessible names are still hard-coded; check visible translations too.
      await expect(
        popup.getByRole("button", { name: "Yes", exact: true }),
      ).toHaveText(copy["dapp.yes"]);
      await expect(
        popup.getByRole("button", { name: "No", exact: true }),
      ).toHaveText(copy["dapp.no"]);
      await capture("approval");
      await popup
        .getByRole("button", { name: "No", exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        popup.getByRole("button", { name: "No", exact: true }),
      ).toBeInViewport();
      await expect(
        popup.getByRole("button", { name: "Yes", exact: true }),
      ).toBeInViewport();
      await capture("approval-actions");
      await popup.getByRole("button", { name: "No", exact: true }).click();
      await dapp.waitForFunction(isRequestDone, {
        stateKey: "requestState" as const,
      });

      await writeStorage(worker, "local", {
        [SETTINGS_KEY]: { ...settings, language: "unsupported-locale" },
      });
      const fallbackPopup = await context.newPage();
      await fallbackPopup.goto(popupUrl);
      await expect(
        fallbackPopup.getByRole("heading", { name: en["home.activeAccount"] }),
      ).toBeVisible();
      await openPreferences(fallbackPopup, en);
      await expect(
        fallbackPopup.getByRole("combobox", { name: "Language", exact: true }),
      ).toHaveText("English");
    } finally {
      await context.close();
      await fixture.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
