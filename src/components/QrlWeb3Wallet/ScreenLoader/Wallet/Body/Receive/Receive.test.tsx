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
  locationState?: unknown,
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

  it("shows the full grouped address at once, without a toggle or a fingerprint", () => {
    renderComponent(
      mockedStore({
        qrlStore: { activeAccount: { accountAddress: ADDRESS } },
      }),
    );

    const full = screen.getByTestId("address-disclosure-full");
    expect(full).toBeVisible();
    expect(full.textContent).toContain("Q 01234 56789 abcde");
    expect(screen.queryByText(FINGERPRINT)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy full address" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show full address" }),
    ).not.toBeInTheDocument();
    // The raw address is exposed to assistive technology once.
    expect(screen.getAllByText(ADDRESS)).toHaveLength(1);
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

  it.each([null, [], "account", { accountAddress: 7 }, { accountAddress: {} }])(
    "uses the active account for malformed route state %j",
    (locationState) => {
      renderComponent(
        mockedStore({
          qrlStore: { activeAccount: { accountAddress: ADDRESS } },
        }),
        locationState,
      );
      expect(screen.getByTestId("qr-code")).toHaveAttribute(
        "data-value",
        ADDRESS,
      );
    },
  );
});
