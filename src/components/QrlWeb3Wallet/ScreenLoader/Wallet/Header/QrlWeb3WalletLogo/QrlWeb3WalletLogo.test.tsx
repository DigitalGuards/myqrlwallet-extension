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

    const mark = screen.getByRole("img", { name: "MyQRLWallet Logo" });
    expect(mark).toBeInTheDocument();
    expect(mark.tagName).toBe("svg");
    expect(mark).toHaveClass("h-6", "w-6");
  });
});
