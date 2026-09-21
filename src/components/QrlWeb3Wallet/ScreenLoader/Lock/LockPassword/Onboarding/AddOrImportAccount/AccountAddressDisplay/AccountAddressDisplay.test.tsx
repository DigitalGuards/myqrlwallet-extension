import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import AccountAddressDisplay from "./AccountAddressDisplay";

const ADDRESS = `Q${"0123456789abcdef".repeat(8)}`;

describe("AccountAddressDisplay", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <AccountAddressDisplay />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the account address display component", () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: ADDRESS,
          },
        },
      }),
    );

    expect(screen.getByText("Account address")).toBeInTheDocument();
    expect(
      screen.getByText(formatQrlAddressFingerprint(ADDRESS)),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show full address" }),
    ).toBeInTheDocument();
  });
});
