import { mockedStore } from "@/__mocks__/mockedStore";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import AddUrlItem from "./AddUrlItem";

describe("AddUrlItem", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (
    mockedStoreValues = mockedStore(),
    mockedProps: ComponentProps<typeof AddUrlItem> = { addUrl: () => {} },
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <AddUrlItem {...mockedProps} />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the add url item component", () => {
    renderComponent();

    expect(
      screen.getByText("You may add URLs, and select one as the default URL."),
    ).toBeInTheDocument();
    const addUrlButton = screen.getByRole("button", {
      name: "Add URL",
    });
    expect(addUrlButton).toBeInTheDocument();
    expect(addUrlButton).toBeEnabled();
  });

  it("should call the addUrl method on clicking add button", async () => {
    const mockedAddUrl = vi.fn(() => {});
    renderComponent(mockedStore(), {
      addUrl: mockedAddUrl,
    });

    const addUrlButton = screen.getByRole("button", {
      name: "Add URL",
    });
    expect(addUrlButton).toBeEnabled();
    await userEvent.click(addUrlButton);
    expect(
      screen.getByRole("heading", { level: 2, name: "Add URL" }),
    ).toBeInTheDocument();
    const urlField = screen.getByRole("textbox", { name: "url" });
    expect(urlField).toBeInTheDocument();
    expect(urlField).toBeEnabled();
    expect(urlField).toHaveValue("");
    expect(urlField).toHaveAttribute("placeholder", "https://url_address");
    expect(screen.getByText("Enter the URL to be added")).toBeInTheDocument();
    const addButton = screen.getByRole("button", { name: "Add" });
    expect(addButton).toBeInTheDocument();
    expect(addButton).toBeDisabled();
    await userEvent.type(urlField, "https://testUrl");
    expect(addButton).toBeEnabled();
    await userEvent.click(addButton);
    expect(mockedAddUrl).toHaveBeenCalledTimes(1);
    expect(mockedAddUrl).toHaveBeenCalledWith("https://testUrl");
  });

  it("reports a failed URL callback and keeps the entered URL", async () => {
    const error = new Error("URL update failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    renderComponent(undefined, {
      addUrl: () => {
        throw error;
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Add URL" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "url" }),
      "https://rpc.example",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith("Failed to add URL:", error);
    });
    expect(screen.getByRole("textbox", { name: "url" })).toHaveValue(
      "https://rpc.example",
    );
  });
});
