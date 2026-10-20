import { mockedStore } from "@/__mocks__/mockedStore";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import ActiveBrowserTab from "./ActiveBrowserTab";

describe("ActiveBrowserTab", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <ActiveBrowserTab />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the active browser tab", () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          hasDAppConnected: true,
          currentTabData: {
            title: "Test Title",
            favIconUrl: "http://testIconUrl",
            urlOrigin: "Test URL origin",
          },
        },
      }),
    );

    expect(screen.getByText("Active browser tab")).toBeInTheDocument();
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "http://testIconUrl");
    expect(img).toHaveAttribute("alt", "Test Title");
    expect(screen.getByText("Test URL origin")).toBeInTheDocument();
    expect(screen.getByText("Test Title")).toBeInTheDocument();
    const disconnectButton = screen.getByRole("button", { name: "Disconnect" });
    expect(disconnectButton).toBeInTheDocument();
  });

  it("should not render the disconnect button if not connected", () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          hasDAppConnected: false,
        },
      }),
    );

    const disconnectButton = screen.queryByRole("button", {
      name: "Disconnect",
    });
    expect(disconnectButton).not.toBeInTheDocument();
  });

  it("should call the disconnectFromCurrentTab function on clicking the disconnect button", async () => {
    const mockedDisconnectFromCurrentTab = vi.fn(async () => {});
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          hasDAppConnected: true,
          currentTabData: { urlOrigin: "testUrlOrigin" },
          disconnectFromCurrentTab: mockedDisconnectFromCurrentTab,
        },
      }),
    );

    const disconnectButton = screen.getByRole("button", { name: "Disconnect" });
    expect(disconnectButton).toBeInTheDocument();
    await userEvent.click(disconnectButton);
    const noButton = screen.getByRole("button", { name: "Cancel Disconnect" });
    expect(noButton).toBeInTheDocument();
    expect(noButton).toBeEnabled();
    const yesButton = screen.getByRole("button", {
      name: "Confirm Disconnect",
    });
    expect(yesButton).toBeInTheDocument();
    expect(yesButton).toBeEnabled();
    expect(screen.getByText("Disconnect")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Do you want to disconnect 'testUrlOrigin' from wallet?",
      ),
    ).toBeInTheDocument();
    await userEvent.click(yesButton);
    expect(mockedDisconnectFromCurrentTab).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected disconnect", async () => {
    const error = new Error("Disconnect failed");
    const disconnectFromCurrentTab = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(error);
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    renderComponent(
      mockedStore({
        dAppRequestStore: { hasDAppConnected: true, disconnectFromCurrentTab },
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm Disconnect" }),
    );
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith("Failed to disconnect dApp:", error);
    });
  });
});
