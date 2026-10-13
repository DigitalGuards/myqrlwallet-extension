import type { ConnectedAccountsDataType } from "@/scripts/middlewares/middlewareTypes";
import type DAppRequestStore from "@/stores/dAppRequestStore";
import { malformed } from "@/test-utils/malformed";
import {
  isUnknownArray,
  type ApprovalBlockchain,
} from "@/utilities/approvalGuards";
import { mockedStore } from "@/__mocks__/mockedStore";
import {
  DEFAULT_BLOCKCHAIN,
  QRL_BLOCKCHAINS,
} from "@/configuration/qrlBlockchainConfig";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

const grantsByOrigin = (
  grants: Partial<
    Record<string, Pick<ConnectedAccountsDataType, "accounts" | "blockchains">>
  >,
) =>
  vi
    .spyOn(StorageUtil, "getDAppsConnectedAccountsData")
    .mockImplementation((origin) => {
      const grant = grants[origin ?? ""];
      return Promise.resolve(
        grant === undefined
          ? undefined
          : { urlOrigin: origin ?? "", permissions: [], ...grant },
      );
    });

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlRequestAccount/QrlRequestAccountContent/QrlRequestAccountAccountSelection/QrlRequestAccountAccountSelection",
  () => ({
    default: () => <div>Mocked Qrl Request Account Account Selection</div>,
  }),
);
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlRequestAccount/QrlRequestAccountContent/QrlRequestAccountBlockchainSelection/QrlRequestAccountBlockchainSelection",
  () => ({
    default: ({ allBlockchains }: { allBlockchains: ApprovalBlockchain[] }) => (
      <>
        <div>Mocked Qrl Request Account Blockchain Selection</div>
        <output aria-label="Available blockchain count">
          {allBlockchains.length}
        </output>
      </>
    ),
  }),
);

describe("QrlRequestAccountContent", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

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
    const addToResponseData = vi.fn<DAppRequestStore["addToResponseData"]>();
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
    const addToResponseData = vi.fn<DAppRequestStore["addToResponseData"]>();
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
    const addToResponseData = vi.fn<DAppRequestStore["addToResponseData"]>();
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
    const preselected = addToResponseData.mock.calls.flatMap((call) =>
      isUnknownArray(call[0].accounts) ? call[0].accounts : [],
    );
    expect(preselected).not.toContain(ACTIVE_TAB_ACCOUNT);
  });

  it("should fall back to the defaults when the sender url is unusable (L4)", async () => {
    const addToResponseData = vi.fn<DAppRequestStore["addToResponseData"]>();
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

  it.each(["chains", "grants"])(
    "disables approval and reports a failed %s read",
    async (source) => {
      const error = new Error("Storage unavailable");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      grantsByOrigin({});
      if (source === "chains") {
        vi.spyOn(StorageUtil, "getAllBlockChains").mockRejectedValue(error);
      } else {
        vi.spyOn(
          StorageUtil,
          "getDAppsConnectedAccountsData",
        ).mockRejectedValue(error);
      }
      const setCanProceed = vi.fn<DAppRequestStore["setCanProceed"]>();
      const addToResponseData = vi.fn<DAppRequestStore["addToResponseData"]>();
      const save = vi.spyOn(StorageUtil, "setAllBlockChains");
      renderComponent(
        mockedStore({
          dAppRequestStore: {
            setCanProceed,
            addToResponseData,
            dAppRequestData: requestFrom(REQUEST_ORIGIN),
          },
        }),
      );
      await waitFor(() => {
        expect(warn).toHaveBeenCalledWith(
          "QrlWeb3Wallet: Error while loading account permissions\n",
          error,
        );
      });
      expect(setCanProceed).toHaveBeenLastCalledWith(false);
      expect(addToResponseData).toHaveBeenLastCalledWith({
        accounts: [],
        blockchains: [],
      });
      expect(save).not.toHaveBeenCalled();
    },
  );

  it.each([
    { chains: [null], grants: undefined },
    {
      chains: [DEFAULT_BLOCKCHAIN],
      grants: { accounts: [42], blockchains: [] },
    },
    {
      chains: [DEFAULT_BLOCKCHAIN],
      grants: { accounts: [], blockchains: [null] },
    },
  ])(
    "rejects malformed stored permission data without rewriting it",
    async ({ chains, grants }) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(StorageUtil, "getAllBlockChains").mockResolvedValue(
        malformed(chains),
      );
      vi.spyOn(StorageUtil, "getDAppsConnectedAccountsData").mockResolvedValue(
        malformed(grants),
      );
      const save = vi.spyOn(StorageUtil, "setAllBlockChains");
      const setCanProceed = vi.fn<DAppRequestStore["setCanProceed"]>();
      renderComponent(
        mockedStore({
          dAppRequestStore: {
            setCanProceed,
            dAppRequestData: requestFrom(REQUEST_ORIGIN),
          },
        }),
      );
      await waitFor(() => {
        expect(warn).toHaveBeenCalled();
      });
      expect(setCanProceed).toHaveBeenLastCalledWith(false);
      expect(save).not.toHaveBeenCalled();
    },
  );

  it.each(["failed", "successful"])(
    "ignores a %s permission read after the requesting origin changes",
    async (outcome) => {
      let rejectFirst: ((reason: Error) => void) | undefined;
      let resolveFirst:
        | ((value: ConnectedAccountsDataType | undefined) => void)
        | undefined;
      const getGrants = vi
        .spyOn(StorageUtil, "getDAppsConnectedAccountsData")
        .mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              rejectFirst = reject;
              resolveFirst = resolve;
            }),
        )
        .mockResolvedValue({
          urlOrigin: "https://second.example",
          accounts: [GRANTED_ACCOUNT],
          blockchains: [DEFAULT_BLOCKCHAIN],
          permissions: [],
        });
      const setCanProceed = vi.fn<DAppRequestStore["setCanProceed"]>();
      const addToResponseData = vi.fn<DAppRequestStore["addToResponseData"]>();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { rerender } = renderComponent(
        mockedStore({
          dAppRequestStore: {
            setCanProceed,
            addToResponseData,
            dAppRequestData: requestFrom(REQUEST_ORIGIN),
          },
        }),
      );
      await waitFor(() => {
        expect(getGrants).toHaveBeenCalledWith(REQUEST_ORIGIN);
      });
      rerender(
        <StoreProvider
          value={mockedStore({
            dAppRequestStore: {
              setCanProceed,
              addToResponseData,
              dAppRequestData: requestFrom("https://second.example"),
            },
          })}
        >
          <MemoryRouter>
            <QrlRequestAccountContent />
          </MemoryRouter>
        </StoreProvider>,
      );
      await waitFor(() => {
        expect(setCanProceed).toHaveBeenLastCalledWith(true);
      });
      await act(async () => {
        if (!rejectFirst || !resolveFirst)
          throw new Error("Missing first permission read");
        if (outcome === "failed")
          rejectFirst(new Error("Obsolete read failed"));
        else resolveFirst(undefined);
        await Promise.resolve();
      });
      expect(addToResponseData).toHaveBeenLastCalledWith({
        accounts: [GRANTED_ACCOUNT],
        blockchains: [DEFAULT_BLOCKCHAIN],
      });
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it("clears available chains when a later permission read fails", async () => {
    const error = new Error("Storage unavailable");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const getGrants = grantsByOrigin({});
    const setCanProceed = vi.fn<DAppRequestStore["setCanProceed"]>();
    const addToResponseData = vi.fn<DAppRequestStore["addToResponseData"]>();
    const save = vi.spyOn(StorageUtil, "setAllBlockChains");
    const storeFor = (origin: string) =>
      mockedStore({
        dAppRequestStore: {
          setCanProceed,
          addToResponseData,
          dAppRequestData: requestFrom(origin),
        },
      });
    const { rerender } = renderComponent(storeFor(REQUEST_ORIGIN));
    await waitFor(() => {
      expect(setCanProceed).toHaveBeenLastCalledWith(true);
    });
    await userEvent.click(screen.getByRole("tab", { name: "Blockchains" }));
    expect(
      screen.getByLabelText("Available blockchain count"),
    ).toHaveTextContent("1");
    getGrants.mockRejectedValue(error);
    rerender(
      <StoreProvider value={storeFor("https://second.example")}>
        <MemoryRouter>
          <QrlRequestAccountContent />
        </MemoryRouter>
      </StoreProvider>,
    );
    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        "QrlWeb3Wallet: Error while loading account permissions\n",
        error,
      );
    });
    expect(
      screen.getByLabelText("Available blockchain count"),
    ).toHaveTextContent("0");
    expect(setCanProceed).toHaveBeenLastCalledWith(false);
    expect(addToResponseData).toHaveBeenLastCalledWith({
      accounts: [],
      blockchains: [],
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("preserves the order and metadata of existing granted chains", async () => {
    const first = {
      ...DEFAULT_BLOCKCHAIN,
      chainId: "0x2",
      extensionMetadata: { keep: true },
    };
    const second = { ...DEFAULT_BLOCKCHAIN, chainId: "0x1" };
    const chains = [first, second, first];
    vi.spyOn(StorageUtil, "getAllBlockChains").mockResolvedValue(chains);
    grantsByOrigin({
      [REQUEST_ORIGIN]: {
        accounts: [GRANTED_ACCOUNT, ACTIVE_ACCOUNT],
        blockchains: chains,
      },
    });
    const save = vi.spyOn(StorageUtil, "setAllBlockChains");
    const addToResponseData = vi.fn<DAppRequestStore["addToResponseData"]>();
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          addToResponseData,
          dAppRequestData: requestFrom(REQUEST_ORIGIN),
        },
      }),
    );
    await waitFor(() => {
      expect(addToResponseData).toHaveBeenLastCalledWith({
        accounts: [GRANTED_ACCOUNT, ACTIVE_ACCOUNT],
        blockchains: chains,
      });
    });
    expect(save).not.toHaveBeenCalled();
  });
});
