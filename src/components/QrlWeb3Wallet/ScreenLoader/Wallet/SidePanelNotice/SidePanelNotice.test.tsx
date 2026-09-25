import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import SidePanelNotice from "./SidePanelNotice";

describe("SidePanelNotice", () => {
  afterEach(cleanup);

  const renderWith = (settings: Record<string, unknown>) => {
    const store = mockedStore({ settingsStore: settings });
    render(
      <StoreProvider value={store}>
        <SidePanelNotice />
      </StoreProvider>,
    );
    return store;
  };

  it("stays hidden when the notice was never armed", () => {
    renderWith({ sidePanelNoticePending: false });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the notice once it is armed", () => {
    renderWith({ sidePanelNoticePending: true });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(/now opens in the side panel/i),
    ).toBeInTheDocument();
  });

  it("switches back to the popup from the inline action", async () => {
    const setSidePanelPreferred = vi.fn(async () => {});
    renderWith({ sidePanelNoticePending: true, setSidePanelPreferred });

    await userEvent.click(
      screen.getByRole("button", { name: "Use the popup instead" }),
    );

    expect(setSidePanelPreferred).toHaveBeenCalledWith(false);
  });

  it("clears the flag when dismissed", async () => {
    const dismissSidePanelNotice = vi.fn(async () => {});
    renderWith({ sidePanelNoticePending: true, dismissSidePanelNotice });

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(dismissSidePanelNotice).toHaveBeenCalledTimes(1);
  });
});
