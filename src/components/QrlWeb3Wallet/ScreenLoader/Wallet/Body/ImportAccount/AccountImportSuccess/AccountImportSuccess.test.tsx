import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Transaction } from "@theqrl/web3";
import { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import AccountImportSuccess from "./AccountImportSuccess";

describe("AccountImportSuccess", () => {
  beforeAll(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(cleanup);

  const renderComponent = (
    mockedStoreValues = mockedStore(),
    mockedProps: ComponentProps<typeof AccountImportSuccess> = {
      account: {
        address: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
        seed: "",
        sign: (data: string | Record<string, unknown>) => ({
          messageHash: typeof data === "string" ? data : JSON.stringify(data),
          signature: typeof data === "string" ? data : JSON.stringify(data),
        }),
        signTransaction: (tx: Transaction) =>
          Promise.resolve({
            messageHash: "",
            signature: "",
            rawTransaction: tx.value?.toString() ?? "",
            transactionHash: "",
          }),
        encrypt: () => Promise.reject(new Error("Not implemented")),
      },
    },
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <AccountImportSuccess {...mockedProps} />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the required details about account import", () => {
    renderComponent();

    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Account imported",
    );
    expect(
      screen.getByText("Q 20fB0 8fF1f 1376A 14C05 5E9F5 6df80 563E1 6722b"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Your account is successfully imported."),
    ).toBeInTheDocument();
  });

  it("should render the copy button and the done button", () => {
    renderComponent();

    const copyButton = screen.getByRole("button", { name: "Copy" });
    expect(copyButton).toBeInTheDocument();
    expect(copyButton).toBeEnabled();

    const doneButton = screen.getByRole("button", { name: "Done" });
    expect(doneButton).toBeInTheDocument();
    expect(doneButton).toBeEnabled();
  });

  it("should copy the account address on clicking the copy button", async () => {
    renderComponent();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const clipboardMock = vi
      .fn<(text: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: clipboardMock,
      },
      writable: true,
    });
    const copyButton = screen.getByRole("button", { name: "Copy" });
    expect(screen.getByText("Copy")).toBeInTheDocument();
    await user.click(copyButton);
    expect(screen.getByText("Copied")).toBeInTheDocument();
    vi.advanceTimersByTime(1000);
    expect(clipboardMock).toHaveBeenCalledTimes(1);
    expect(clipboardMock).toHaveBeenCalledWith(
      "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
    );
  });
});
