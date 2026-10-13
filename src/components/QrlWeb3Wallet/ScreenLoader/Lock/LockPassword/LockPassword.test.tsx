import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LockPassword from "./LockPassword";
import browser from "webextension-polyfill";

vi.mock("webextension-polyfill", async () => {
  const originalModule = await vi.importActual<{ default: typeof browser }>(
    "webextension-polyfill",
  );
  return {
    ...originalModule,
    default: {
      ...originalModule.default,
      tabs: {
        ...originalModule.default.tabs,
        create: vi.fn().mockResolvedValue({ id: 1 }),
      },
      runtime: {
        ...originalModule.default.runtime,
        getURL: vi.fn().mockReturnValue("chrome-extension://id/index.html"),
      },
    },
  };
});
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/Onboarding/Onboarding",
  () => ({ default: () => <div>Mocked Onboarding</div> }),
);
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/LockPasswordCheck/LockPasswordCheck",
  () => ({ default: () => <div>Mocked Lock Password Check</div> }),
);

describe("LockPassword", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <LockPassword />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the onboarding screen if the password has not been set", async () => {
    renderComponent(
      mockedStore({
        lockStore: { hasPasswordSet: false, isLocked: true },
        settingsStore: { isPopupWindow: false },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Mocked Onboarding")).toBeInTheDocument();
      expect(
        screen.queryByText("Mocked Lock Password Check"),
      ).not.toBeInTheDocument();
    });
  });

  it("should render the lock password check screen if the password was set", async () => {
    renderComponent(
      mockedStore({
        lockStore: { hasPasswordSet: true, isLocked: true },
        settingsStore: { isPopupWindow: false },
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Mocked Lock Password Check"),
      ).toBeInTheDocument();
      expect(screen.queryByText("Mocked Onboarding")).not.toBeInTheDocument();
    });
  });

  it("opens onboarding in a tab from the popup", async () => {
    const createTab = vi.spyOn(browser.tabs, "create");
    renderComponent(
      mockedStore({
        lockStore: { hasPasswordSet: false, isLocked: true },
        settingsStore: { isPopupWindow: true },
      }),
    );

    await waitFor(() => {
      expect(createTab).toHaveBeenCalledWith({
        url: "chrome-extension://id/index.html",
      });
    });
  });

  it("reports a rejected onboarding tab creation", async () => {
    const error = new Error("tab creation failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(browser.tabs, "create").mockRejectedValueOnce(error);
    renderComponent(
      mockedStore({
        lockStore: { hasPasswordSet: false, isLocked: true },
        settingsStore: { isPopupWindow: true },
      }),
    );

    await waitFor(() => {
      expect(report).toHaveBeenCalledWith("Failed to open onboarding:", error);
    });
  });
});
