import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import AddressDisclosure from "./AddressDisclosure";
import AddressFingerprint from "./AddressFingerprint";
import FullAddress from "./FullAddress";

const ADDRESS = `Q${"0123456789abcdef".repeat(8)}`;
const FINGERPRINT = "Q01234567...cdef0123...89abcdef";

describe("address display primitives", () => {
  afterEach(cleanup);

  it("renders the approved first, middle, and final fingerprint", () => {
    render(<AddressFingerprint address={ADDRESS} />);

    expect(screen.getByText(FINGERPRINT)).toBeInTheDocument();
    expect(screen.getByText(ADDRESS)).toHaveClass("sr-only");
    expect(screen.getByTitle(ADDRESS)).toHaveClass("max-w-full");
  });

  it("contains the complete review value inside narrow parents", () => {
    render(<FullAddress address={ADDRESS} />);

    const visible = screen.getByText(/^Q /);
    expect(visible.textContent?.split(" ").join("")).toBe(ADDRESS);
    expect(screen.getByTitle(ADDRESS)).toHaveClass(
      "min-w-0",
      "max-w-full",
      "[overflow-wrap:anywhere]",
    );
  });

  it("reveals the complete grouped address and can collapse it", async () => {
    render(<AddressDisclosure address={ADDRESS} />);

    const reveal = screen.getByRole("button", { name: "Show full address" });
    expect(reveal).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("address-disclosure-full"),
    ).not.toBeInTheDocument();

    await userEvent.click(reveal);
    expect(screen.getByTestId("address-disclosure-full")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide full address" }),
    ).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(
      screen.getByRole("button", { name: "Hide full address" }),
    );
    expect(
      screen.queryByTestId("address-disclosure-full"),
    ).not.toBeInTheDocument();
  });

  it("copies the exact unformatted address", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<AddressDisclosure address={ADDRESS} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Copy full address" }),
    );

    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
