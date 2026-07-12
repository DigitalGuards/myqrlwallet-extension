import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AllNFTCollections from "./AllNFTCollections";

const { mockNFTCollections } = vi.hoisted(() => ({
  mockNFTCollections: vi.fn((_props: object) => (
    <div>Mocked NFT collections</div>
  )),
}));

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/NFTCollections/NFTCollections",
  () => ({ default: (props: object) => mockNFTCollections(props) }),
);

describe("AllNFTCollections", () => {
  afterEach(() => {
    cleanup();
    mockNFTCollections.mockClear();
  });

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <AllNFTCollections />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the all NFT collections screen with the full list", () => {
    renderComponent();

    expect(screen.getByText("All NFT collections")).toBeInTheDocument();
    expect(screen.getByText("Mocked NFT collections")).toBeInTheDocument();
    expect(mockNFTCollections).toHaveBeenCalledWith(
      expect.objectContaining({ shouldDisplayAllCollections: true }),
    );
  });
});
