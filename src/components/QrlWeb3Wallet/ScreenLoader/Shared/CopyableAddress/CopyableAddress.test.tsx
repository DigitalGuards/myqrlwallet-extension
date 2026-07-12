import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CopyableAddress from "./CopyableAddress";

const ADDRESS = "Q830f30ace20b9d3658a74f8cb1195054791c8871";

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
