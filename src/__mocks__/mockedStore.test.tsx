import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockedStore, StoreProvider, useStore } from "./mockedStore";

afterEach(cleanup);

describe("mocked store", () => {
  it("merges nested overrides and isolates mutable records between stores", () => {
    const setLanguage =
      vi.fn<ReturnType<typeof mockedStore>["settingsStore"]["setLanguage"]>();
    const first = mockedStore({
      settingsStore: { language: "de", setLanguage },
      qrlStore: {
        qrlAccounts: {
          accounts: [{ accountAddress: "first", accountBalance: "1" }],
        },
      },
    });
    first.qrlStore.qrlAccounts.accounts.push({
      accountAddress: "second",
      accountBalance: "2",
    });
    first.accountLabelsStore.labels.first = "Account 1";
    const second = mockedStore();

    expect(first.settingsStore.language).toBe("de");
    expect(first.settingsStore).toHaveProperty("setLanguage", setLanguage);
    expect(first.settingsStore.theme).toBe("dark");
    expect(
      first.qrlStore.qrlAccounts.accounts.map(
        (account) => account.accountAddress,
      ),
    ).toEqual(["first", "second"]);
    expect(second.settingsStore.language).toBe("en");
    expect(second.qrlStore.qrlAccounts.accounts).toEqual([]);
    expect(second.accountLabelsStore.labels).toEqual({});
  });

  it("returns the typed promise results used by components", async () => {
    const store = mockedStore();
    await expect(store.lockStore.unlock("password")).resolves.toBe("success");
    await expect(store.lockStore.unlock("")).resolves.toBe("wrong-password");
    await expect(store.lockStore.getMnemonicPhrases("account")).resolves.toBe(
      "account",
    );
    await expect(store.qrlStore.probeConnectionNow()).resolves.toEqual({
      probed: true,
      isConnected: true,
    });
    await expect(
      store.qrlStore.getTransactionReceipt("hash"),
    ).resolves.toBeUndefined();
    await expect(
      store.settingsStore.whenSettingsLoaded(),
    ).resolves.toBeUndefined();
  });

  it("exposes a store through context with and without a provider", () => {
    const Probe = () => {
      const { settingsStore } = useStore();
      return <span>{settingsStore.language}</span>;
    };
    const { rerender } = render(<Probe />);
    expect(screen.getByText("en")).toBeInTheDocument();
    rerender(
      <StoreProvider value={mockedStore({ settingsStore: { language: "de" } })}>
        <Probe />
      </StoreProvider>,
    );
    expect(screen.getByText("de")).toBeInTheDocument();
  });
});
