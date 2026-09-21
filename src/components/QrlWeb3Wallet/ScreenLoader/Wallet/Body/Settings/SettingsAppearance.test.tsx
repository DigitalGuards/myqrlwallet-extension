import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import SettingsAppearance from "./SettingsAppearance";

vi.setConfig({ testTimeout: 15000 });

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("SettingsAppearance", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <SettingsAppearance />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the Appearance heading", () => {
    renderComponent();

    expect(screen.getByText("Appearance")).toBeInTheDocument();
  });

  it("should render the theme select trigger", () => {
    renderComponent();

    expect(screen.getByRole("combobox", { name: "Theme" })).toBeInTheDocument();
  });

  it("should call setThemePreference when selecting Light", async () => {
    const setThemePreference = vi.fn(() => Promise.resolve());
    renderComponent(
      mockedStore({
        settingsStore: { themePreference: "system", setThemePreference },
      }),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Theme" }));
    await userEvent.click(screen.getByRole("option", { name: "Light" }));

    expect(setThemePreference).toHaveBeenCalledWith("light");
  });

  it("should call setThemePreference when selecting Dark", async () => {
    const setThemePreference = vi.fn(() => Promise.resolve());
    renderComponent(
      mockedStore({
        settingsStore: { themePreference: "system", setThemePreference },
      }),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Theme" }));
    await userEvent.click(screen.getByRole("option", { name: "Dark" }));

    expect(setThemePreference).toHaveBeenCalledWith("dark");
  });
});
