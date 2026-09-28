import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SettingsAbout from "./SettingsAbout";

const EXPECTED_LINKS: Array<[string, string]> = [
  ["Privacy Policy", "https://qrlwallet.com/privacy"],
  ["Terms of Use", "https://qrlwallet.com/terms"],
  ["Disclaimer", "https://qrlwallet.com/disclaimer"],
  ["Legal notice", "https://qrlwallet.com/legal"],
  [
    "Open-source licences",
    "https://github.com/DigitalGuards/myqrlwallet-extension/blob/main/LICENSE",
  ],
  ["Visit our website", "https://myqrlwallet.com"],
  ["Web wallet", "https://qrlwallet.com"],
  ["Source code", "https://github.com/DigitalGuards/myqrlwallet-extension"],
  ["Report a security issue", "https://qrlwallet.com/security"],
  ["Contact us", "mailto:info@digitalguards.nl"],
  ["MyQRLWallet on X", "https://x.com/myqrlwallet"],
];

describe("SettingsAbout", () => {
  afterEach(cleanup);

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <SettingsAbout />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the About heading", () => {
    renderComponent();

    expect(screen.getByText("About")).toBeInTheDocument();
  });

  it("should show the brand mark and the version line", () => {
    renderComponent();

    expect(
      screen.getByRole("img", { name: "MyQRLWallet" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^MyQRLWallet Version /)).toBeInTheDocument();
  });

  it("should display wallet info", () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          qrlConnection: {
            isConnected: true,
            isLoading: false,
            blockchain: {
              chainId: "0x1",
              chainName: "QRL Testnet",
            },
          },
          qrlAccounts: {
            isLoading: false,
            accounts: [
              {
                accountAddress: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
                accountBalance: "0",
              },
              {
                accountAddress: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
                accountBalance: "0",
              },
            ],
          },
        },
      }),
    );

    // The version is shown once, in the "MyQRLWallet Version x.y.z" line.
    expect(screen.queryByText("Version")).not.toBeInTheDocument();
    expect(screen.getByText("QRL Testnet")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("should group the links under Legal and Help and contact", () => {
    renderComponent();

    expect(screen.getByRole("region", { name: "Legal" })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Help and contact" }),
    ).toBeInTheDocument();
  });

  it.each(EXPECTED_LINKS)(
    "should link %s to %s in a new tab",
    (label, href) => {
      renderComponent();

      const link = screen.getByRole("link", { name: new RegExp(`^${label}`) });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    },
  );

  it("should render exactly the expected external links", () => {
    renderComponent();

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(EXPECTED_LINKS.map(([, href]) => href));
  });
});
