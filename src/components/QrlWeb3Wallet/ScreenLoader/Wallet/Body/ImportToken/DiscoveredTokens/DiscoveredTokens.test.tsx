import { mockedStore } from "@/__mocks__/mockedStore";
import { discoverTokens } from "@/services/assetDiscovery";
import { StoreProvider } from "@/stores/store";
import type StorageUtil from "@/utilities/storageUtil";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ROUTES } from "@/router/router";
import { formatQrlAddressFingerprint } from "@/utilities/addressUtil";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiscoveredTokens from "./DiscoveredTokens";

const CONTRACT_ADDRESS = `Q${"0123456789abcdef".repeat(8)}`;
const DISCOVERED = {
  address: CONTRACT_ADDRESS,
  name: "Test Token",
  symbol: "TEST",
  decimals: 18,
};
const SECOND = {
  address: `Q${"fedcba9876543210".repeat(8)}`,
  name: "Second Token",
  symbol: "SEC",
  decimals: 6,
};
const chainToken = (symbol: string, decimals: bigint) => ({
  token: {
    name: "Chain Name",
    symbol,
    decimals,
    totalSupply: 1000,
    balance: 1,
    balanceBaseUnits: "1",
    image: "",
  },
  error: "",
});

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
  const getZrc20TokenDetails =
    vi.fn<ReturnType<typeof mockedStore>["qrlStore"]["getZrc20TokenDetails"]>();

  const component = (accountAddress: string) => (
    <StoreProvider
      value={mockedStore({
        qrlStore: { activeAccount: { accountAddress }, getZrc20TokenDetails },
      })}
    >
      <MemoryRouter initialEntries={[ROUTES.IMPORT_TOKEN]}>
        <Routes>
          <Route path={ROUTES.IMPORT_TOKEN} element={<DiscoveredTokens />} />
          <Route path={ROUTES.HOME} element={<div>Home screen</div>} />
        </Routes>
      </MemoryRouter>
    </StoreProvider>
  );

  const renderComponent = () => render(component(`Q${"a".repeat(128)}`));

  beforeEach(() => {
    vi.mocked(discoverTokens).mockResolvedValue([DISCOVERED]);
    getTokenContractsList.mockReset().mockResolvedValue([]);
    setTokenContractsList.mockReset().mockResolvedValue(undefined);
    getZrc20TokenDetails
      .mockReset()
      .mockResolvedValue(chainToken("CHAIN", BigInt(9)));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("lists a discovered token with its name, symbol and address fingerprint", async () => {
    renderComponent();

    expect(await screen.findByText("Test Token")).toBeInTheDocument();
    expect(screen.getByText("(TEST)")).toBeInTheDocument();
    expect(
      screen.getByText(formatQrlAddressFingerprint(CONTRACT_ADDRESS)),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("keeps Add selected disabled until a token is picked", async () => {
    renderComponent();

    const checkbox = await screen.findByRole("checkbox");
    expect(
      screen.getByRole("button", { name: "Add selected (0)" }),
    ).toBeDisabled();
    await userEvent.click(checkbox);
    expect(
      screen.getByRole("button", { name: "Add selected (1)" }),
    ).toBeEnabled();
    await userEvent.click(checkbox);
    expect(
      screen.getByRole("button", { name: "Add selected (0)" }),
    ).toBeDisabled();
    expect(setTokenContractsList).not.toHaveBeenCalled();
  });

  it("reads every pick from the chain and stores the chain values", async () => {
    vi.mocked(discoverTokens).mockResolvedValue([DISCOVERED, SECOND]);
    getZrc20TokenDetails.mockImplementation((address) =>
      Promise.resolve(
        address === SECOND.address
          ? chainToken("SEC2", BigInt(8))
          : chainToken("TEST2", BigInt(12)),
      ),
    );
    renderComponent();

    await userEvent.click(
      await screen.findByRole("checkbox", { name: /Test Token/ }),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /Second/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "Add selected (2)" }),
    );

    expect(await screen.findByText("Home screen")).toBeInTheDocument();
    expect(getZrc20TokenDetails).toHaveBeenCalledWith(CONTRACT_ADDRESS);
    expect(getZrc20TokenDetails).toHaveBeenCalledWith(SECOND.address);
    expect(setTokenContractsList).toHaveBeenCalledTimes(2);
    expect(setTokenContractsList).toHaveBeenCalledWith(`Q${"a".repeat(128)}`, {
      address: CONTRACT_ADDRESS,
      symbol: "TEST2",
      decimals: 12,
      image: "",
    });
    expect(setTokenContractsList).toHaveBeenCalledWith(`Q${"a".repeat(128)}`, {
      address: SECOND.address,
      symbol: "SEC2",
      decimals: 8,
      image: "",
    });
  });

  it("writes picks one at a time", async () => {
    vi.mocked(discoverTokens).mockResolvedValue([DISCOVERED, SECOND]);
    let inFlight = 0;
    let maxInFlight = 0;
    setTokenContractsList.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    });
    renderComponent();

    await userEvent.click(
      await screen.findByRole("checkbox", { name: /Test Token/ }),
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /Second/ }));
    await userEvent.click(
      screen.getByRole("button", { name: "Add selected (2)" }),
    );

    expect(await screen.findByText("Home screen")).toBeInTheDocument();
    expect(setTokenContractsList).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
  });

  it.each([
    ["an error", () => Promise.resolve({ token: undefined, error: "Nope" })],
    ["no token", () => Promise.resolve({ token: undefined, error: "" })],
    ["a rejection", () => Promise.reject(new Error("RPC down"))],
  ])(
    "keeps a pick out of the wallet when its chain read returns %s",
    async (_label, read) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(discoverTokens).mockResolvedValue([DISCOVERED, SECOND]);
      getZrc20TokenDetails.mockImplementation((address) =>
        address === CONTRACT_ADDRESS
          ? read()
          : Promise.resolve(chainToken("SEC", BigInt(6))),
      );
      renderComponent();

      await userEvent.click(
        await screen.findByRole("checkbox", { name: /Test Token/ }),
      );
      await userEvent.click(screen.getByRole("checkbox", { name: /Second/ }));
      await userEvent.click(
        screen.getByRole("button", { name: "Add selected (2)" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not read Test Token from the chain.",
      );
      expect(setTokenContractsList).toHaveBeenCalledTimes(1);
      expect(setTokenContractsList).toHaveBeenCalledWith(
        `Q${"a".repeat(128)}`,
        expect.objectContaining({ address: SECOND.address }),
      );
      // The added token leaves the list; the failed one stays picked for a
      // retry.
      expect(screen.queryByText("Second Token")).not.toBeInTheDocument();
      expect(
        screen.getByRole("checkbox", { name: /Test Token/ }),
      ).toBeChecked();
      expect(
        screen.getByRole("button", { name: "Add selected (1)" }),
      ).toBeEnabled();
      expect(screen.queryByText("Home screen")).not.toBeInTheDocument();
    },
  );

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
    expect(screen.queryByText("Test Token")).not.toBeInTheDocument();
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
