import { mockedStore } from "@/__mocks__/mockedStore";
import { RESTRICTED_METHODS } from "@/scripts/constants/requestConstants";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DAppRequestFeature from "./DAppRequestFeature";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlRequestAccount/QrlRequestAccount",
  () => ({ default: () => <div>Mocked Qrl Request Account</div> }),
);
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlSendTransaction/QrlSendTransaction",
  () => ({ default: () => <div>Mocked Qrl Send Transaction</div> }),
);
vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlSignTypedDataV4/QrlSignTypedDataV4",
  () => ({ default: () => <div>Mocked Signature Request</div> }),
);

describe("DAppRequestFeature", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <DAppRequestFeature />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the dapp request feature component, for qrl_requestAccounts rpc call", () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: { method: RESTRICTED_METHODS.QRL_REQUEST_ACCOUNTS },
        },
      }),
    );

    expect(screen.getByText("Mocked Qrl Request Account")).toBeInTheDocument();
  });

  it("should render the dapp request feature component, for qrl_sendTransaction rpc call", () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: { method: RESTRICTED_METHODS.QRL_SEND_TRANSACTION },
        },
      }),
    );

    expect(screen.getByText("Mocked Qrl Send Transaction")).toBeInTheDocument();
  });

  it("renders the signature request for personal_sign", () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: { method: RESTRICTED_METHODS.PERSONAL_SIGN },
        },
      }),
    );

    expect(screen.getByText("Mocked Signature Request")).toBeInTheDocument();
  });

  it("renders nothing for qrl_signTypedData_v4, which the middleware refuses", () => {
    const { container } = renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: {
            method: RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA_V4,
          },
        },
      }),
    );

    expect(
      screen.queryByText("Mocked Signature Request"),
    ).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
