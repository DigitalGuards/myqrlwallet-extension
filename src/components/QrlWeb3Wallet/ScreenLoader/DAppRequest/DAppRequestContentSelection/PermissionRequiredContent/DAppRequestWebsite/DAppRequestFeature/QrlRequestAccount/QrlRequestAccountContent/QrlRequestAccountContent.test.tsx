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
import StorageUtil from "@/utilities/storageUtil";

const ACTIVE_ACCOUNT = `Q${"a".repeat(128)}`;
const GRANTED_ACCOUNT = `Q${"b".repeat(128)}`;
const ACTIVE_TAB_ACCOUNT = `Q${"c".repeat(128)}`;
const REQUEST_ORIGIN = "https://dapp.example";

/** A request from REQUEST_ORIGIN, whatever the active browser tab shows. */
const requestFrom = (url: string) => ({
  method: "qrl_requestAccounts",
  requestId: "request-a",
  requestData: { senderData: { url } },
});

const grantsByOrigin = (grants: Record<string, unknown>) =>
  vi
    .spyOn(StorageUtil, "getDAppsConnectedAccountsData")
    .mockImplementation(async (origin) => grants[origin ?? ""] as never);

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
    grantsByOrigin({
      [REQUEST_ORIGIN]: { accounts: [GRANTED_ACCOUNT], blockchains: [] },
    });
    renderComponent(
      mockedStore({
        qrlStore: { qrlAccounts: { isLoading: false } },
        dAppRequestStore: {
          dAppRequestData: requestFrom(`${REQUEST_ORIGIN}/app`),
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
    grantsByOrigin({});
    const addToResponseData = vi.fn();
    const setCanProceed = vi.fn();
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          addToResponseData,
          setCanProceed,
          dAppRequestData: requestFrom(`${REQUEST_ORIGIN}/app`),
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

  it("should keep the site's existing grants when it has some", async () => {
    const addToResponseData = vi.fn();
    const grantedChain = QRL_BLOCKCHAINS[0];
    grantsByOrigin({
      [REQUEST_ORIGIN]: {
        accounts: [GRANTED_ACCOUNT],
        blockchains: [grantedChain],
      },
    });
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          addToResponseData,
          dAppRequestData: requestFrom(`${REQUEST_ORIGIN}/app`),
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

  it("should read the grants of the requesting origin, never the active tab (L4)", async () => {
    const addToResponseData = vi.fn();
    const getGrants = grantsByOrigin({
      [REQUEST_ORIGIN]: { accounts: [GRANTED_ACCOUNT], blockchains: [] },
      "https://other.example": {
        accounts: [ACTIVE_TAB_ACCOUNT],
        blockchains: [],
      },
    });
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          addToResponseData,
          dAppRequestData: requestFrom(`${REQUEST_ORIGIN}/app`),
          // The tab the user happens to be looking at.
          currentTabData: {
            urlOrigin: "https://other.example",
            connectedAccounts: [ACTIVE_TAB_ACCOUNT],
            connectedBlockchains: [],
          },
        },
      }),
    );

    await waitFor(() => {
      expect(addToResponseData).toHaveBeenCalledWith(
        expect.objectContaining({ accounts: [GRANTED_ACCOUNT] }),
      );
    });
    expect(getGrants).toHaveBeenCalledWith(REQUEST_ORIGIN);
    expect(getGrants).not.toHaveBeenCalledWith("https://other.example");
    const preselected = addToResponseData.mock.calls.flatMap(
      (call) => (call[0] as { accounts?: string[] }).accounts ?? [],
    );
    expect(preselected).not.toContain(ACTIVE_TAB_ACCOUNT);
  });

  it("should fall back to the defaults when the sender url is unusable (L4)", async () => {
    const addToResponseData = vi.fn();
    const getGrants = grantsByOrigin({});
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          addToResponseData,
          dAppRequestData: requestFrom("not a url"),
          currentTabData: {
            urlOrigin: "https://other.example",
            connectedAccounts: [ACTIVE_TAB_ACCOUNT],
            connectedBlockchains: [],
          },
        },
      }),
    );

    await waitFor(() => {
      expect(addToResponseData).toHaveBeenCalledWith(
        expect.objectContaining({ accounts: [ACTIVE_ACCOUNT] }),
      );
    });
    expect(getGrants).not.toHaveBeenCalled();
  });
});
