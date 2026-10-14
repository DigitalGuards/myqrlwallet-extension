import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { GasFeeNotice } from "./GasFeeNotice";

describe("GasFeeNotice", () => {
  afterEach(cleanup);

  const renderComponent = (
    mockedStoreValues = mockedStore(),
    mockedProps: ComponentProps<typeof GasFeeNotice> = {
      isZrc20Token: false,
      tokenContractAddress: "",
      tokenDecimals: 18,
      isSubmitting: false,
      from: "",
      to: "",
      value: 1.5,
    },
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <GasFeeNotice {...mockedProps} />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the gas fee notice component", async () => {
    renderComponent(undefined, {
      isZrc20Token: false,
      tokenContractAddress: "",
      tokenDecimals: 18,
      isSubmitting: false,
      from: "0x205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
      to: "0x20fB08fF1f1376A14C055E9F56df80563E16722b",
      value: 0.45,
    });

    expect(screen.getByText("Estimating gas fee")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Estimating gas fee")).not.toBeInTheDocument();
    });
    expect(
      screen.getByText("Estimated gas fee is 0.0 Quanta"),
    ).toBeInTheDocument();
  });

  it("should not render the gas fee notice component if value, to or from are not available", () => {
    renderComponent();

    expect(screen.queryByText("Estimating gas fee")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Estimated gas fee is 0.0000 Quanta"),
    ).not.toBeInTheDocument();
  });

  it("should display the estimated gas fee for native token", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          getNativeTokenGas: vi.fn().mockResolvedValue("2.64"),
        },
      }),
      {
        isZrc20Token: false,
        tokenContractAddress: "",
        tokenDecimals: 18,
        isSubmitting: false,
        from: "0x205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
        to: "0x20fB08fF1f1376A14C055E9F56df80563E16722b",
        value: 1.45,
      },
    );

    expect(screen.getByText("Estimating gas fee")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Estimating gas fee")).not.toBeInTheDocument();
    });
    expect(
      screen.getByText("Estimated gas fee is 2.64 Quanta"),
    ).toBeInTheDocument();
  });

  it("should call onGasFeeCalculated with raw gas fee", async () => {
    const onGasFeeCalculated = vi.fn();
    renderComponent(
      mockedStore({
        qrlStore: {
          getNativeTokenGas: vi.fn().mockResolvedValue("2.64"),
        },
      }),
      {
        isZrc20Token: false,
        tokenContractAddress: "",
        tokenDecimals: 18,
        isSubmitting: false,
        from: "0x205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
        to: "0x20fB08fF1f1376A14C055E9F56df80563E16722b",
        value: 1.45,
        onGasFeeCalculated,
      },
    );

    expect(screen.getByText("Estimating gas fee")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Estimating gas fee")).not.toBeInTheDocument();
    });
    expect(onGasFeeCalculated).toHaveBeenCalledWith("2.64");
  });

  it("should display the estimated gas fee for ZRC 20 token", async () => {
    renderComponent(
      mockedStore({
        qrlStore: {
          getZrc20TokenGas: vi.fn().mockResolvedValue("5.2564854"),
        },
      }),
      {
        isZrc20Token: true,
        tokenContractAddress: "0x28c4113a9d3a2e836f28c23ed8e3c1e7c243f566",
        tokenDecimals: 18,
        isSubmitting: false,
        from: "0x205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
        to: "0x20fB08fF1f1376A14C055E9F56df80563E16722b",
        value: 1.45,
      },
    );

    expect(screen.getByText("Estimating gas fee")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Estimating gas fee")).not.toBeInTheDocument();
    });
    expect(
      screen.getByText("Estimated gas fee is 5.2564 Quanta"),
    ).toBeInTheDocument();
  });

  it.each([false, true])(
    "reports a rejected estimate for token mode %s",
    async (isZrc20Token) => {
      const failure = new Error("RPC unavailable");
      const onGasFeeCalculated = vi.fn();
      renderComponent(
        mockedStore({
          qrlStore: {
            getNativeTokenGas: vi.fn().mockRejectedValue(failure),
            getZrc20TokenGas: vi.fn().mockRejectedValue(failure),
          },
        }),
        {
          isZrc20Token,
          tokenContractAddress: "token",
          tokenDecimals: 18,
          from: "sender",
          to: "recipient",
          value: 1,
          isSubmitting: false,
          onGasFeeCalculated,
        },
      );
      expect(
        await screen.findByText("Error: RPC unavailable"),
      ).toBeInTheDocument();
      expect(onGasFeeCalculated).toHaveBeenCalledWith("");
    },
  );

  it("reports a callback failure after estimating gas", async () => {
    const failure = new Error("Fee callback failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderComponent(undefined, {
        isZrc20Token: false,
        tokenContractAddress: "",
        tokenDecimals: 18,
        from: "sender",
        to: "recipient",
        value: 1,
        isSubmitting: false,
        onGasFeeCalculated: () => {
          throw failure;
        },
      });
      await waitFor(() => {
        expect(report).toHaveBeenCalledWith(
          "[GasFeeNotice] Failed to report gas estimate:",
          failure,
        );
      });
    } finally {
      report.mockRestore();
    }
  });
});
