import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import Receive from "./Receive";

const ADDRESS = `Q${"0123456789abcdef".repeat(8)}`;
const OTHER_ADDRESS = `Q${"fedcba9876543210".repeat(8)}`;
const FINGERPRINT = "Q01234567...cdef0123...89abcdef";

vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <div data-testid="qr-code" data-value={value} />
  ),
}));

const renderComponent = (
  mockedStoreValues = mockedStore(),
  locationState?: { accountAddress: string },
) =>
  render(
    <StoreProvider value={mockedStoreValues}>
      <MemoryRouter
        initialEntries={[{ pathname: "/receive", state: locationState }]}
      >
        <Receive />
      </MemoryRouter>
    </StoreProvider>,
  );

describe("Receive", () => {
  afterEach(cleanup);

  it("should render the Receive heading", () => {
    renderComponent();

    expect(screen.getByText("Receive")).toBeInTheDocument();
  });

  it("should render a QR code for the active account", () => {
    renderComponent(
      mockedStore({
        qrlStore: { activeAccount: { accountAddress: ADDRESS } },
      }),
    );

    const qr = screen.getByTestId("qr-code");
    expect(qr).toBeInTheDocument();
    expect(qr).toHaveAttribute("data-value", ADDRESS);
  });

  it("should use accountAddress from location state when provided", () => {
    renderComponent(mockedStore(), { accountAddress: OTHER_ADDRESS });

    const qr = screen.getByTestId("qr-code");
    expect(qr).toHaveAttribute("data-value", OTHER_ADDRESS);
  });

  it("should display the approved compact address fingerprint", () => {
    renderComponent(
      mockedStore({
        qrlStore: { activeAccount: { accountAddress: ADDRESS } },
      }),
    );

    expect(screen.getByText(FINGERPRINT)).toBeInTheDocument();
    expect(screen.getByText(ADDRESS)).toHaveClass("sr-only");
  });

  it("should copy address to clipboard on click", async () => {
    const mockedWriteText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: mockedWriteText },
      writable: true,
    });

    renderComponent(
      mockedStore({
        qrlStore: { activeAccount: { accountAddress: ADDRESS } },
      }),
    );

    const copyButton = screen.getByRole("button", {
      name: "Copy full address",
    });
    await userEvent.click(copyButton);

    expect(mockedWriteText).toHaveBeenCalledWith(ADDRESS);
  });
});
