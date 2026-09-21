import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import AccountBadge from "./AccountBadge";

describe("AccountBadge", () => {
  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <AccountBadge />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the account address in the shortened form with ellipses in between", () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
          },
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
    expect(
      screen.getByRole("button", {
        name: "Accounts: Q20fB08fF1f1376A14C055E9F56df80563E16722b",
      }),
    ).toBeInTheDocument();
  });
});
