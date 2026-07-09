import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BackgroundVideo from "./BackgroundVideo";

describe("BackgroundVideo", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <BackgroundVideo />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the brand tree background", () => {
    renderComponent();

    const treeElement = screen.getByTestId("backgroundVideoTestId");
    expect(treeElement).toBeInTheDocument();
    expect(treeElement).toHaveAttribute("src", "tree.svg");
  });
});
