import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { ZRC_20_ITEMS_DISPLAY_LIMIT } from "@/constants/zrc20Token";
import ZRC20Tokens from "./ZRC20Tokens";

vi.mock("@/utilities/storageUtil", async () => {
  const originalModule = await vi.importActual<
    typeof import("@/utilities/storageUtil")
  >("@/utilities/storageUtil");
  return {
    ...originalModule,
    default: {
      ...originalModule.default,
      getTokenContractsList: vi.fn(async () => [
        {
          address: "Q28c4113a9d3a2e836f28c23ed8e3c1e7c243f566",
          image: "testImage1",
        },
        {
          address: "Q978918b7b544ad491d0b294cc6ac4d7bb0ef7112",
          image: "testImage2",
        },
        {
          address: "Q0db3981cb93db985e4e3a62ff695f7a1b242dd7c",
          image: "testImage3",
        },
      ]),
    },
  };
});
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/ZRC20Tokens/ZRC20Token/ZRC20Token",
  () => ({ default: () => <div>Mocked ZRC 20 token</div> }),
);

describe("ZRC20Tokens", () => {
  afterEach(cleanup);

  const renderComponent = (
    mockedStoreValues = mockedStore({
      qrlStore: {
        getZrc20TokenDetails: async (contractAddress: string) => {
          const tokenContracts = {
            "0x28c4113a9d3a2e836f28c23ed8e3c1e7c243f566": {
              token: {
                balance: 12,
                balanceBaseUnits: "12000000000000000000",
                decimals: BigInt(18),
                name: "COIN1",
                symbol: "CO1",
                totalSupply: 100000,
                image: "",
              },
              error: "",
            },
            "0x978918b7b544ad491d0b294cc6ac4d7bb0ef7112": {
              token: {
                balance: 56,
                balanceBaseUnits: "56000000000000000000",
                decimals: BigInt(18),
                name: "COIN2",
                symbol: "CO2",
                totalSupply: 100000,
                image: "",
              },
              error: "",
            },
            "0x0db3981cb93db985e4e3a62ff695f7a1b242dd7c": {
              token: {
                balance: 96,
                balanceBaseUnits: "96000000000000000000",
                decimals: BigInt(18),
                name: "COIN3",
                symbol: "CO3",
                totalSupply: 100,
                image: "",
              },
              error: "",
            },
          };
          return (
            tokenContracts[contractAddress as keyof typeof tokenContracts] ?? {}
          );
        },
      },
    }),
    mockedProps: ComponentProps<typeof ZRC20Tokens> = {},
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <ZRC20Tokens {...mockedProps} />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should display all the tokens if shouldDisplayAllTokens is true ", async () => {
    renderComponent(undefined, { shouldDisplayAllTokens: true });

    await waitFor(() => {
      expect(screen.getAllByText("Mocked ZRC 20 token")).toHaveLength(3);
    });
  });

  it("should display only allowed number of tokens if shouldDisplayAllTokens is false ", async () => {
    renderComponent(undefined, { shouldDisplayAllTokens: false });

    await waitFor(() => {
      expect(screen.getAllByText("Mocked ZRC 20 token")).toHaveLength(
        ZRC_20_ITEMS_DISPLAY_LIMIT,
      );
    });
  });
});
