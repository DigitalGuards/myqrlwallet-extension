import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TokensCardContent from "./TokensCardContent";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/ZRC20Tokens/ZRC20Tokens",
  () => ({ default: () => <div>Mocked ZRC 20 token</div> }),
);

describe("TokensCardContent", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TokensCardContent />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the token card content component", () => {
    renderComponent();

    expect(screen.getByText("Mocked ZRC 20 token")).toBeInTheDocument();
  });

  it("should not list the native asset as a token", () => {
    renderComponent();

    // QRL is the chain's native asset; its balance lives on the Active
    // account card, never in the token list.
    expect(screen.queryByText(/native/i)).not.toBeInTheDocument();
  });
});
