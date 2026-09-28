import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/UI/Tooltip";
import PersonalSign from "./PersonalSign";

vi.mock("@/scripts/utils/restrictedMethodsMiddlewareUtils", () => ({
  revalidateAuthorizedDAppRequest: vi.fn(async () => ({
    canProceed: true,
    proceedError: undefined,
  })),
}));

describe("PersonalSign", () => {
  afterEach(cleanup);

  const message =
    "0x506c65617365207369676e2074686973206d65737361676520746f20636f6e6669726d20796f7572206964656e746974792e";
  const fromAddress = "Q20D20b8026B8F02540246f58120ddAAf35AECD9B";

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <PersonalSign />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("should render the personal sign component", () => {
    const expectedMessage =
      "Please sign this message to confirm your identity.";
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [message, fromAddress],
          },
        },
      }),
    );

    expect(screen.getByText("From Address")).toBeInTheDocument();
    expect(
      screen.getByText("Q 20D20 b8026 B8F02 54024 6f581 20ddA Af35A ECD9B"),
    ).toBeInTheDocument();
    expect(screen.getByText("Message")).toBeInTheDocument();
    expect(screen.getByText(expectedMessage)).toBeInTheDocument();
    const copyButton = screen.getByRole("button", { name: "Copy message" });
    expect(copyButton).toBeInTheDocument();
    expect(copyButton).toBeEnabled();
  });

  it("should copy the message to clipboard", async () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [message, fromAddress],
          },
        },
      }),
    );
    const clipboardMock = vi.fn().mockResolvedValue(void 0 as never);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: clipboardMock,
      },
      writable: true,
    });
    const copyButton = screen.getByRole("button", { name: "Copy message" });
    await userEvent.click(copyButton);
    expect(clipboardMock).toHaveBeenCalledTimes(1);
    expect(clipboardMock).toHaveBeenCalledWith(
      "Please sign this message to confirm your identity.",
    );
  });

  it("shows a translated message, re-polls lock state, and sends a stable 4100 error to the dApp when signing hits a locked wallet (L1)", async () => {
    let capturedPermissionCallback:
      | ((hasApproved: boolean) => Promise<void>)
      | null = null;
    const mockReadLockState = vi.fn().mockResolvedValue(undefined);
    const addToResponseData = vi.fn();

    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [message, fromAddress],
          },
          setOnPermissionCallBack: (cb: any) => {
            capturedPermissionCallback = cb;
          },
          addToResponseData,
        },
        lockStore: {
          getMnemonicPhrases: vi
            .fn()
            .mockRejectedValue(new Error("MyQRLWallet is locked")),
          readLockState: mockReadLockState,
        },
      }),
    );

    expect(capturedPermissionCallback).not.toBeNull();
    await act(async () => capturedPermissionCallback!(true));

    expect(
      screen.getByText("The wallet is locked. Unlock it to continue."),
    ).toBeInTheDocument();
    expect(mockReadLockState).toHaveBeenCalled();
    expect(addToResponseData).toHaveBeenCalledWith({
      error: expect.objectContaining({
        code: 4100,
        message: "The wallet is locked",
      }),
    });
  });
});
