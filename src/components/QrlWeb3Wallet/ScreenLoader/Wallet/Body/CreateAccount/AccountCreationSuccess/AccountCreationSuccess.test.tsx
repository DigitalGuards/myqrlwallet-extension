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
import { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import AccountCreationSuccess from "./AccountCreationSuccess";

describe("AccountCreationSuccess", () => {
  beforeAll(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(cleanup);

  const renderComponent = (
    mockedStoreValues = mockedStore(),
    mockedProps: ComponentProps<typeof AccountCreationSuccess> = {
      account: {
        address: "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
        seed: "",
        sign: (_data: Record<string, unknown> | string) => {
          return { messageHash: "", signature: "", message: "" };
        },
        signTransaction: () =>
          Promise.resolve({
            messageHash: "",
            rawTransaction: "",
            signature: "",
            transactionHash: "",
          }),
        encrypt: () => {
          return Promise.reject(new Error("Not implemented"));
        },
      },
    },
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <AccountCreationSuccess account={mockedProps.account} />
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the account creation sucess component", () => {
    renderComponent();

    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent(
      "Account created",
    );
    expect(screen.getByText("Account public address:")).toBeInTheDocument();
    expect(
      screen.getByText("Q 20504 6e6A6 E159e D6ACe dE46A 36CAD 6D449 C80A1"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "You can share this account public address with anyone. Others need it to interact with you.",
      ),
    ).toBeInTheDocument();
    const copyButton = screen.getByRole("button", { name: "Copy" });
    const doneButton = screen.getByRole("button", { name: "Done" });
    expect(copyButton).toBeInTheDocument();
    expect(copyButton).toBeEnabled();
    expect(doneButton).toBeInTheDocument();
    expect(doneButton).toBeEnabled();
  });

  it("should copy the account address to clipboard", async () => {
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
      "Q205046e6A6E159eD6ACedE46A36CAD6D449C80A1",
    );
  });
});
