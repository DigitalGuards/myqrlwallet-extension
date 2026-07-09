import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DAppNotConnected from "./DAppNotConnected";

describe("DAppNotConnected", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <DAppNotConnected />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the dapp not connected component", () => {
    renderComponent();

    expect(screen.getByTestId("unlink-icon")).toBeInTheDocument();
    expect(screen.getByText("Not Connected")).toBeInTheDocument();
    expect(
      screen.getByText("MyQRLWallet is not connected with this website."),
    ).toBeInTheDocument();
  });
});
