import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import AccountAddressSection from "./AccountAddressSection";

const ACTIVE_ACCOUNT = `Q${"a".repeat(128)}`;
const DISPLAY_ADDRESS = formatQrlAddressFingerprint(ACTIVE_ACCOUNT);

describe("AccountAddressSection", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <AccountAddressSection />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the account address section component", () => {
    renderComponent();

    expect(screen.getByText("Account address")).toBeInTheDocument();
    expect(screen.getByText(DISPLAY_ADDRESS)).toBeInTheDocument();
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("0.0 Quanta")).toBeInTheDocument();
  });
});
