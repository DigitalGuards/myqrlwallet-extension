import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CopyableAddress from "./CopyableAddress";

const ADDRESS = `Q${"0123456789abcdef".repeat(8)}`;

describe("CopyableAddress", () => {
  afterEach(cleanup);

  it("renders the grouped address text", () => {
    render(<CopyableAddress address={ADDRESS} />);
    // StringUtil splits the hex into space-separated groups after the prefix.
    expect(screen.getByText(/^Q /)).toBeInTheDocument();
  });

  it("copies the RAW address (no grouping spaces) to the clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyableAddress address={ADDRESS} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(ADDRESS);
  });
});
