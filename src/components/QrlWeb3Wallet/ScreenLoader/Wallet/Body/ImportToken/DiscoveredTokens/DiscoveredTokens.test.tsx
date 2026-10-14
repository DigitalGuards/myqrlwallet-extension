import { mockedStore } from "@/__mocks__/mockedStore";
import { discoverTokens } from "@/services/assetDiscovery";
import { StoreProvider } from "@/stores/store";
import type StorageUtil from "@/utilities/storageUtil";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiscoveredTokens from "./DiscoveredTokens";

const CONTRACT_ADDRESS = `Q${"0123456789abcdef".repeat(8)}`;
const DISCOVERED = {
  address: CONTRACT_ADDRESS,
  name: "Test Token",
  symbol: "TEST",
  decimals: 18,
};

const { getTokenContractsList, setTokenContractsList } = vi.hoisted(() => ({
  getTokenContractsList: vi.fn<typeof StorageUtil.getTokenContractsList>(),
  setTokenContractsList: vi.fn<typeof StorageUtil.setTokenContractsList>(),
}));

vi.mock("@/services/assetDiscovery", () => ({
  discoverTokens: vi.fn(),
  MAX_DISCOVERED_TOKENS: 50,
}));

vi.mock("@/utilities/storageUtil", () => ({
  default: {
    getTokenContractsList,
    setTokenContractsList,
  },
}));

describe("DiscoveredTokens", () => {
  const onReview = vi.fn<(token: typeof DISCOVERED) => Promise<void>>();

  const component = (accountAddress: string) => (
    <StoreProvider
      value={mockedStore({ qrlStore: { activeAccount: { accountAddress } } })}
    >
      <MemoryRouter>
        <DiscoveredTokens onReview={onReview} />
      </MemoryRouter>
    </StoreProvider>
  );

  const renderComponent = () => render(component(`Q${"a".repeat(128)}`));

  beforeEach(() => {
    vi.mocked(discoverTokens).mockResolvedValue([DISCOVERED]);
    getTokenContractsList.mockReset().mockResolvedValue([]);
    onReview.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("lists a discovered token with its contract address", async () => {
    renderComponent();

    expect(await screen.findByText(CONTRACT_ADDRESS)).toBeInTheDocument();
    expect(screen.getByText("Test Token")).toBeInTheDocument();
  });

  it("opens the review screen before storing a picked token", async () => {
    renderComponent();

    await userEvent.click(
      await screen.findByRole("button", { name: "Review Test Token" }),
    );

    await waitFor(() => {
      expect(onReview).toHaveBeenCalledWith(DISCOVERED);
    });
    expect(setTokenContractsList).not.toHaveBeenCalled();
  });

  it("hides tokens the account already imported", async () => {
    getTokenContractsList.mockResolvedValue([
      {
        address: CONTRACT_ADDRESS.toUpperCase(),
        symbol: "TEST",
        decimals: 18,
        image: "",
      },
    ]);

    const { container } = renderComponent();

    await waitFor(() => {
      expect(discoverTokens).toHaveBeenCalled();
      expect(getTokenContractsList).toHaveBeenCalled();
    });
    expect(screen.queryByText(CONTRACT_ADDRESS)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
  it("says the list is capped when the explorer filled it", async () => {
    // A capped response means the account holds more than the picker can
    // show; a list that simply ends looks complete.
    vi.mocked(discoverTokens).mockResolvedValue(
      Array.from({ length: 50 }, (_unused, index) => ({
        ...DISCOVERED,
        address: `Q${index.toString(16).padStart(128, "0")}`,
        name: `Token ${index}`,
      })),
    );
    renderComponent();

    expect(
      await screen.findByText("Showing the first 50 found."),
    ).toBeInTheDocument();
  });

  it("says nothing about a cap for a short list", async () => {
    renderComponent();

    expect(await screen.findByText("Test Token")).toBeInTheDocument();
    expect(
      screen.queryByText("Showing the first 50 found."),
    ).not.toBeInTheDocument();
  });

  it.each(["discovery", "storage"])(
    "reports a rejected %s read",
    async (source) => {
      const error = new Error("Read failed");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      if (source === "discovery")
        vi.mocked(discoverTokens).mockRejectedValueOnce(error);
      else getTokenContractsList.mockRejectedValueOnce(error);

      const { container } = renderComponent();
      await waitFor(() => {
        expect(report).toHaveBeenCalledWith(
          "[DiscoveredTokens] Failed to load tokens:",
          error,
        );
      });
      expect(container).toBeEmptyDOMElement();
      expect(setTokenContractsList).not.toHaveBeenCalled();
    },
  );

  it("reports a failed review and enables a retry", async () => {
    const error = new Error("Review failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    onReview.mockRejectedValueOnce(error);
    renderComponent();

    const button = await screen.findByRole("button", {
      name: "Review Test Token",
    });
    await userEvent.click(button);
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "[DiscoveredTokens] Failed to review token:",
        error,
      );
    });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onReview).toHaveBeenCalledTimes(2);
    expect(setTokenContractsList).not.toHaveBeenCalled();
  });

  it("ignores a late response for the previous account", async () => {
    let finish = (_tokens: (typeof DISCOVERED)[]) => {};
    const pending = new Promise<(typeof DISCOVERED)[]>((resolve) => {
      finish = resolve;
    });
    vi.mocked(discoverTokens)
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce([
        {
          ...DISCOVERED,
          name: "Current Token",
          address: `Q${"b".repeat(128)}`,
        },
      ]);
    const { rerender } = renderComponent();
    rerender(component(`Q${"c".repeat(128)}`));
    expect(await screen.findByText("Current Token")).toBeInTheDocument();
    await act(async () => {
      finish([DISCOVERED]);
      await pending;
    });
    expect(screen.getByText("Current Token")).toBeInTheDocument();
    expect(screen.queryByText("Test Token")).not.toBeInTheDocument();
  });
});
