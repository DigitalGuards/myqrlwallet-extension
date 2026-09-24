import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import AccountId from "./AccountId";

describe("AccountId", () => {
  afterEach(cleanup);

  const renderComponent = (
    mockedStoreValues = mockedStore(),
    mockedProps: ComponentProps<typeof AccountId> = {
      account: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
    },
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <AccountId {...mockedProps} />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the account id component", () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          getAccountBalance: () => "10.0 QRL",
        },
      }),
    );

    expect(
      screen.getByText(
        formatQrlAddressFingerprint(
          "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
        ),
      ),
    ).toBeInTheDocument();
    // The row re-applies the shared balance rule, so "10.0" renders as "10.00".
    expect(screen.getByText("10.00 QRL")).toBeInTheDocument();
  });

  it("can preserve the complete grouped address for approval surfaces", () => {
    const address = "Q20fB08fF1f1376A14C055E9F56df80563E16722b";
    renderComponent(mockedStore(), { account: address, display: "full" });

    expect(screen.getByText(address)).toHaveClass("sr-only");
    expect(screen.getByTitle(address)).toBeInTheDocument();
  });
});
