import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SwitchQrlChainInfo from "./SwitchQrlChainInfo";
import StorageUtil from "@/utilities/storageUtil";
import { malformed } from "@/test-utils/malformed";

vi.mock("@/utilities/storageUtil", async () => {
  const originalModule = await vi.importActual<
    typeof import("@/utilities/storageUtil")
  >("@/utilities/storageUtil");
  return {
    ...originalModule,
    default: {
      ...originalModule.default,
      getActiveBlockChain: vi.fn(() => Promise.resolve({ chainId: "0x33" })),
      getAllBlockChains: vi.fn(() =>
        Promise.resolve([
          {
            chainId: "0x33",
          },
          {
            chainId: "0x11",
          },
        ]),
      ),
    },
  };
});
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/SwitchQrlChainContent/SwitchQrlChainInfo/ChainInfoCard/ChainInfoCard",
  () => ({ default: () => <div>Mocked Chain Info Card</div> }),
);

describe("SwitchQrlChainInfo", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <SwitchQrlChainInfo />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the switch qrl chain content component", async () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: { params: [{ chainId: "0x11" }] },
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getAllByText("Mocked Chain Info Card")).toHaveLength(2);
      expect(screen.getByTestId("arrow-down-icon")).toBeInTheDocument();
    });
  });

  it.each(
    [undefined, null, "params", [], [{ chainId: 17 }]].map((params) => ({
      params,
    })),
  )(
    "keeps malformed request data out of chain comparisons: %j",
    async ({ params }) => {
      const getAllBlockChains = vi.spyOn(StorageUtil, "getAllBlockChains");
      renderComponent(
        mockedStore({ dAppRequestStore: { dAppRequestData: { params } } }),
      );
      await waitFor(() => {
        expect(getAllBlockChains).toHaveBeenCalled();
      });
      expect(
        screen.queryByText("Mocked Chain Info Card"),
      ).not.toBeInTheDocument();
    },
  );

  it.each([undefined, null, {}, { chainId: 17 }])(
    "handles a missing or malformed active chain: %j",
    async (chain) => {
      const getAllBlockChains = vi.spyOn(StorageUtil, "getAllBlockChains");
      vi.spyOn(StorageUtil, "getActiveBlockChain").mockResolvedValueOnce(
        malformed(chain),
      );
      renderComponent(
        mockedStore({
          dAppRequestStore: {
            dAppRequestData: { params: [{ chainId: "0x11" }] },
          },
        }),
      );
      await waitFor(() => {
        expect(getAllBlockChains).toHaveBeenCalled();
      });
      expect(
        screen.queryByText("Mocked Chain Info Card"),
      ).not.toBeInTheDocument();
    },
  );

  const chainReadMethods: ("getActiveBlockChain" | "getAllBlockChains")[] = [
    "getActiveBlockChain",
    "getAllBlockChains",
  ];
  it.each(chainReadMethods)("reports a rejected %s read", async (method) => {
    const error = new Error("Storage unavailable");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(StorageUtil, method).mockRejectedValueOnce(error);
    renderComponent();
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        "QrlWeb3Wallet: Failed to load switch-chain details",
        error,
      );
    });
    expect(
      screen.queryByText("Mocked Chain Info Card"),
    ).not.toBeInTheDocument();
  });
});
