import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DAppRequestWebsite from "./DAppRequestWebsite";

vi.mock(
  "@/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/DAppRequestFeature",
  () => ({ default: () => <div>Mocked DApp Request Feature</div> }),
);

type SenderDataOverride = {
  url?: string;
  favIconUrl?: string;
  title?: string;
  mainFrameOrigin?: string;
};

describe("DAppRequestWebsite", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <DAppRequestWebsite />
        </MemoryRouter>
      </StoreProvider>,
    );

  const renderWithSenderData = (senderData: SenderDataOverride) =>
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: {
            requestData: { senderData },
          },
        },
      } as Parameters<typeof mockedStore>[0]),
    );

  it("should render the dapp request website component", () => {
    renderComponent();

    expect(screen.getByText("http://localhost")).toBeInTheDocument();
    expect(screen.getByText("Mocked Page Title")).toBeInTheDocument();
    expect(screen.getByText("Mocked DApp Request Feature")).toBeInTheDocument();
  });

  it("shows the registrable domain as the primary identity line", () => {
    renderWithSenderData({ url: "https://dev.qrlwallet.com/connect" });

    expect(screen.getByText("qrlwallet.com")).toBeInTheDocument();
    expect(screen.getByText("https://dev.qrlwallet.com")).toBeInTheDocument();
  });

  it("surfaces the owning label of a spoofing origin that would otherwise be clipped", () => {
    const spoofOrigin =
      "https://qrlwallet.com.secure.login.attacker-controlled-domain.example";
    renderWithSenderData({ url: `${spoofOrigin}/approve` });

    expect(
      screen.getByText("attacker-controlled-domain.example"),
    ).toBeInTheDocument();
    expect(screen.getByText(spoofOrigin)).toBeInTheDocument();
  });

  it("renders the full origin on a wrapping line so it is never clipped", () => {
    const spoofOrigin =
      "https://qrlwallet.com.secure.login.attacker-controlled-domain.example";
    renderWithSenderData({ url: `${spoofOrigin}/approve` });

    const originLine = screen.getByText(spoofOrigin);
    expect(originLine).toHaveClass("break-all");
    expect(originLine).toHaveClass("font-mono");
  });

  it("labels the page-supplied title as untrusted without an em dash", () => {
    renderWithSenderData({
      url: "https://dev.qrlwallet.com/connect",
      title: "MyQRLWallet",
    });

    expect(screen.getByText("(page-supplied)")).toBeInTheDocument();
    const titleLine = screen.getByTitle(
      "page-supplied title, do not trust it as the origin",
    );
    expect(titleLine).toBeInTheDocument();
    // The repo forbids the em dash in copy, so this matches it by code
    // point and keeps the character itself out of the file.
    expect(titleLine.getAttribute("title")).not.toContain(
      String.fromCharCode(0x2014),
    );
  });

  it("shows the registrable domain and the full origin of a cross-origin iframe parent", () => {
    renderWithSenderData({
      url: "https://dapp.example/widget",
      mainFrameOrigin: "https://qrlwallet.com.attacker.example",
    });

    expect(screen.getByText("Embedded request:")).toBeInTheDocument();
    expect(screen.getByText("attacker.example")).toBeInTheDocument();
    const parentOriginLine = screen.getByText(
      "https://qrlwallet.com.attacker.example",
    );
    expect(parentOriginLine).toHaveClass("break-all");
  });

  it("does not warn when the iframe parent shares the requesting origin", () => {
    renderWithSenderData({
      url: "https://dapp.example/widget",
      mainFrameOrigin: "https://dapp.example",
    });

    expect(screen.queryByText("Embedded request:")).not.toBeInTheDocument();
  });

  it("still renders an identity line when the sender url cannot be parsed", () => {
    renderWithSenderData({ url: "not-a-url" });

    expect(screen.getAllByText("not-a-url").length).toBeGreaterThan(0);
    expect(screen.getByText("Mocked DApp Request Feature")).toBeInTheDocument();
  });
});
