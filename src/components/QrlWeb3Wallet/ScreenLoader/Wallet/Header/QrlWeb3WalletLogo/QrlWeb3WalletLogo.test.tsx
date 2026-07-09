import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import QrlWeb3WalletLogo from "./QrlWeb3WalletLogo";
import { TooltipProvider } from "@/components/UI/Tooltip";

describe("QrlWeb3WalletLogo", () => {
  const renderComponent = () =>
    render(
      <MemoryRouter>
        <TooltipProvider>
          <QrlWeb3WalletLogo />
        </TooltipProvider>
      </MemoryRouter>,
    );

  it("should render the qrl web3 wallet logo in the component", () => {
    renderComponent();

    const img = screen.getByAltText("MyQRLWallet Logo");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "icons/qrl/default.png");
    expect(img).toHaveClass("h-6", "w-6");
  });
});
