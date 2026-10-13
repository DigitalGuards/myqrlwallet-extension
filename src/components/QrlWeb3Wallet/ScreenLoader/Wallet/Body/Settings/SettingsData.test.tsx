import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import StorageUtil, {
  KeystoreStorageCorruptError,
} from "@/utilities/storageUtil";
import SettingsData from "./SettingsData";

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    storage: {
      local: {
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve()),
      },
      session: {
        get: vi.fn(() => Promise.resolve({})),
        set: vi.fn(() => Promise.resolve()),
      },
    },
  },
}));

describe("SettingsData", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <SettingsData />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the Data heading", () => {
    renderComponent();

    expect(screen.getByText("Data")).toBeInTheDocument();
  });

  it("should render the Export Backup button", () => {
    renderComponent();

    expect(
      screen.getByRole("button", { name: /Export Backup/i }),
    ).toBeInTheDocument();
  });

  it("shows a fixed message for other export failures", async () => {
    const getKeystores = vi
      .spyOn(StorageUtil, "getKeystores")
      .mockRejectedValueOnce(new Error("QUOTA_BYTES quota exceeded"));
    try {
      renderComponent();
      await userEvent.click(
        screen.getByRole("button", { name: /Export Backup/i }),
      );

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "The wallet backup could not be exported. Please try again.",
      );
      expect(alert).not.toHaveTextContent("QUOTA_BYTES");
    } finally {
      getKeystores.mockRestore();
    }
  });

  it("shows corrupt wallet data without downloading a backup", async () => {
    const getKeystores = vi
      .spyOn(StorageUtil, "getKeystores")
      .mockRejectedValueOnce(new KeystoreStorageCorruptError());
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    try {
      renderComponent();
      const exportButton = screen.getByRole("button", {
        name: /Export Backup/i,
      });
      await userEvent.click(exportButton);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The wallet data in this browser could not be read.",
      );
      expect(click).not.toHaveBeenCalled();
      expect(exportButton).toBeEnabled();
      expect(
        screen.getByRole("button", { name: /Reset Wallet/i }),
      ).toBeEnabled();
    } finally {
      getKeystores.mockRestore();
      click.mockRestore();
    }
  });

  it("should render the description text", () => {
    renderComponent();

    expect(
      screen.getByText(/Export encrypted keystores/),
    ).toBeInTheDocument();
  });

  it("should render the Reset Wallet button", () => {
    renderComponent();

    expect(
      screen.getByRole("button", { name: /Reset Wallet/i }),
    ).toBeInTheDocument();
  });

  it("should not reset until the confirmation word is typed", async () => {
    const resetWallet = vi.fn<() => Promise<void>>(() => Promise.resolve());
    renderComponent(mockedStore({ lockStore: { resetWallet } }));

    await userEvent.click(
      screen.getByRole("button", { name: /Reset Wallet/i }),
    );

    const confirmButton = screen.getByRole("button", {
      name: "Reset wallet",
    });
    expect(confirmButton).toBeDisabled();

    await userEvent.type(
      screen.getByPlaceholderText("RESET"),
      "RESET",
    );
    expect(confirmButton).toBeEnabled();

    await userEvent.click(confirmButton);
    expect(resetWallet).toHaveBeenCalledTimes(1);
  });

  it("should not reset when the dialog is cancelled", async () => {
    const resetWallet = vi.fn<() => Promise<void>>(() => Promise.resolve());
    renderComponent(mockedStore({ lockStore: { resetWallet } }));

    await userEvent.click(
      screen.getByRole("button", { name: /Reset Wallet/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(resetWallet).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Reset wallet" }),
    ).not.toBeInTheDocument();
  });

  it("restarts the surface after a successful reset", async () => {
    // Storage and the service worker are wiped, but this document's stores
    // still hold the destroyed wallet: without a reload, onboarding renders
    // the old account's address.
    const reload = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload },
    });

    try {
      const resetWallet = vi.fn<() => Promise<void>>(() => Promise.resolve());
      renderComponent(mockedStore({ lockStore: { resetWallet } }));

      await userEvent.click(
        screen.getByRole("button", { name: /Reset Wallet/i }),
      );
      await userEvent.type(screen.getByPlaceholderText("RESET"), "RESET");
      await userEvent.click(
        screen.getByRole("button", { name: "Reset wallet" }),
      );

      expect(resetWallet).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("does not restart the surface when the reset fails", async () => {
    const reload = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload },
    });

    try {
      const resetWallet = vi.fn<() => Promise<void>>(() =>
        Promise.reject(new Error("storage unavailable")),
      );
      renderComponent(mockedStore({ lockStore: { resetWallet } }));

      await userEvent.click(
        screen.getByRole("button", { name: /Reset Wallet/i }),
      );
      await userEvent.type(screen.getByPlaceholderText("RESET"), "RESET");
      await userEvent.click(
        screen.getByRole("button", { name: "Reset wallet" }),
      );

      expect(reload).not.toHaveBeenCalled();
      expect(
        screen.getByText(/The reset did not complete/),
      ).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });
});
