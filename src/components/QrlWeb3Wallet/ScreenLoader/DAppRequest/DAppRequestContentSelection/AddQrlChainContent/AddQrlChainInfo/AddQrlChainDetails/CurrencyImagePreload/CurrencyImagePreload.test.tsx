import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CurrencyImagePreload from "./CurrencyImagePreload";

const createdImages: HTMLImageElement[] = [];
function mockImage() {
  const image = document.createElement("img");
  createdImages.push(image);
  return image;
}

const imageAt = (index: number) => {
  const image = createdImages.find((_image, current) => current === index);
  if (!image) throw new Error("Missing image preload");
  return image;
};

describe("CurrencyImagePreload", () => {
  beforeEach(() => {
    createdImages.length = 0;
    vi.spyOn(globalThis, "Image").mockImplementation(mockImage);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const VALID_DATA_URI = "data:image/svg+xml;base64,valid-icon";
  const BAD_DATA_URI = "data:image/svg+xml;base64,bad-icon";
  const ANOTHER_DATA_URI = "data:image/svg+xml;base64,another-icon";

  it("renders the first valid image after an earlier load fails", async () => {
    render(
      <CurrencyImagePreload
        iconUrls={[BAD_DATA_URI, VALID_DATA_URI, ANOTHER_DATA_URI]}
      />,
    );

    expect(imageAt(0)).toHaveAttribute("src", BAD_DATA_URI);
    fireEvent.error(imageAt(0));
    await waitFor(() => {
      expect(createdImages).toHaveLength(2);
    });
    expect(imageAt(1)).toHaveAttribute("src", VALID_DATA_URI);
    fireEvent.load(imageAt(1));
    await waitFor(() => {
      expect(
        screen.getByRole("img", { name: "Currency icon" }),
      ).toHaveAttribute("src", VALID_DATA_URI);
    });
    expect(createdImages).toHaveLength(2);
  });

  it("does not render if all URLs fail", async () => {
    render(
      <CurrencyImagePreload iconUrls={[BAD_DATA_URI, ANOTHER_DATA_URI]} />,
    );
    fireEvent.error(imageAt(0));
    await waitFor(() => {
      expect(createdImages).toHaveLength(2);
    });
    fireEvent.error(imageAt(1));
    await waitFor(() => {
      expect(
        screen.getByRole("img", { name: "Currency icon" }),
      ).not.toHaveAttribute("src");
    });
  });

  it("skips remote URLs and malformed entries without creating an image", () => {
    render(
      <CurrencyImagePreload
        iconUrls={[
          "https://valid-icon.svg",
          "http://valid-icon.png",
          "file:///valid-icon.png",
          null,
          42,
          {},
        ]}
      />,
    );
    expect(createdImages).toHaveLength(0);
    expect(
      screen.getByRole("img", { name: "Currency icon" }),
    ).not.toHaveAttribute("src");
  });

  it("ignores a completed load from a replaced request", async () => {
    const { rerender } = render(
      <CurrencyImagePreload iconUrls={[VALID_DATA_URI]} />,
    );
    rerender(<CurrencyImagePreload iconUrls={[ANOTHER_DATA_URI]} />);
    fireEvent.load(imageAt(1));
    await waitFor(() => {
      expect(
        screen.getByRole("img", { name: "Currency icon" }),
      ).toHaveAttribute("src", ANOTHER_DATA_URI);
    });
    fireEvent.load(imageAt(0));
    await waitFor(() => {
      expect(
        screen.getByRole("img", { name: "Currency icon" }),
      ).toHaveAttribute("src", ANOTHER_DATA_URI);
    });
  });

  it("cleans up a pending load on unmount", async () => {
    const { unmount } = render(
      <CurrencyImagePreload iconUrls={[VALID_DATA_URI]} />,
    );
    unmount();
    fireEvent.load(imageAt(0));
    await waitFor(() => {
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });
  });
});
