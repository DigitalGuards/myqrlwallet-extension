import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import ActiveAccountDisplay from "./ActiveAccountDisplay";

describe("ActiveAccountDisplay", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <ActiveAccountDisplay />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the active account details", () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          activeAccount: {
            accountAddress: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
          },
          getAccountBalance: (_accountAddress: string) => {
            return "2.45 QRL";
          },
        },
      }),
    );

    expect(screen.getByText("2.45")).toBeInTheDocument();
    expect(screen.getByText("QRL")).toBeInTheDocument();
    expect(
      screen.getByText("Q20504...C80A1"),
    ).toBeInTheDocument();
  });
});
