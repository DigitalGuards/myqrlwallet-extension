import { mockedStore } from "@/__mocks__/mockedStore";
import {
  DEFAULT_BLOCKCHAIN,
  QRL_BLOCKCHAINS,
} from "@/configuration/qrlBlockchainConfig";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import QrlRequestAccountContent from "./QrlRequestAccountContent";

const ACTIVE_ACCOUNT = `Q${"a".repeat(128)}`;
const GRANTED_ACCOUNT = `Q${"b".repeat(128)}`;

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlRequestAccount/QrlRequestAccountContent/QrlRequestAccountAccountSelection/QrlRequestAccountAccountSelection",
  () => ({
    default: () => <div>Mocked Qrl Request Account Account Selection</div>,
  }),
);
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlRequestAccount/QrlRequestAccountContent/QrlRequestAccountBlockchainSelection/QrlRequestAccountBlockchainSelection",
  () => ({
    default: () => <div>Mocked Qrl Request Account Blockchain Selection</div>,
  }),
);

describe("QrlRequestAccountContent", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <QrlRequestAccountContent />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the qrl request account content component", async () => {
    renderComponent(
      mockedStore({
        qrlStore: { qrlAccounts: { isLoading: false } },
        dAppRequestStore: {
          currentTabData: {
            connectedAccounts: [GRANTED_ACCOUNT],
          },
        },
      }),
    );

    const accountsTab = screen.getByRole("tab", { name: "Accounts" });
    expect(accountsTab).toBeInTheDocument();
    const blockchainsTab = screen.getByRole("tab", { name: "Blockchains" });
    expect(blockchainsTab).toBeInTheDocument();
    expect(
      screen.getByText("Mocked Qrl Request Account Account Selection"),
    ).toBeInTheDocument();
    await userEvent.click(blockchainsTab);
    expect(
      screen.getByText("Mocked Qrl Request Account Blockchain Selection"),
    ).toBeInTheDocument();
  });

  it("should preselect the active account and active chain on a first connect", async () => {
    const addToResponseData = vi.fn();
    const setCanProceed = vi.fn();
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          addToResponseData,
          setCanProceed,
          currentTabData: {},
        },
      }),
    );

    await waitFor(() => {
      expect(addToResponseData).toHaveBeenCalledWith({
        // The mocked store's active account.
        accounts: [ACTIVE_ACCOUNT],
        blockchains: [
          expect.objectContaining({ chainId: DEFAULT_BLOCKCHAIN.chainId }),
        ],
      });
      expect(setCanProceed).toHaveBeenLastCalledWith(true);
    });
  });

  it("should keep the site's existing grants instead of the defaults", async () => {
    const addToResponseData = vi.fn();
    const grantedChain = QRL_BLOCKCHAINS[0];
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          addToResponseData,
          currentTabData: {
            connectedAccounts: [GRANTED_ACCOUNT],
            connectedBlockchains: [grantedChain],
          },
        },
      }),
    );

    await waitFor(() => {
      expect(addToResponseData).toHaveBeenCalledWith({
        accounts: [GRANTED_ACCOUNT],
        blockchains: [
          expect.objectContaining({ chainId: grantedChain.chainId }),
        ],
      });
    });
  });
});
