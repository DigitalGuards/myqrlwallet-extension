import { mockedStore } from "@/__mocks__/mockedStore";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";
import { StoreProvider, type StoreType } from "@/stores/store";
import { malformed } from "@/test-utils/malformed";
import Web3 from "@theqrl/web3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { toChecksumAddress } from "@theqrl/wallet.js";
import PersonalSign from "./PersonalSign";

const EXTENDED_SEED =
  "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";
type QrlInstance = NonNullable<StoreType["qrlStore"]["qrlInstance"]>;
type Sign = QrlInstance["accounts"]["sign"];
type PermissionCallback = StoreType["dAppRequestStore"]["onPermissionCallBack"];

const createQrlInstance = (address: string, sign: Sign) => {
  const instance = new Web3().qrl;
  const account = instance.accounts.seedToAccount(EXTENDED_SEED);
  vi.spyOn(instance.accounts, "seedToAccount").mockReturnValue({
    ...account,
    address,
  });
  vi.spyOn(instance.accounts, "sign").mockImplementation(sign);
  return instance;
};

const objectContaining = (value: Record<string, unknown>): unknown =>
  expect.objectContaining(value);

// The mocked lock store hands back an address where a mnemonic belongs, so
// the real derivation would throw before signing is ever reached.
vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: () => EXTENDED_SEED,
}));

vi.mock("@/scripts/utils/restrictedMethodsMiddlewareUtils", () => ({
  revalidateAuthorizedDAppRequest: vi.fn(() =>
    Promise.resolve({
      canProceed: true,
      proceedError: undefined,
    }),
  ),
}));

describe("PersonalSign", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const capturePermission = () => {
    const setCallback =
      vi.fn<StoreType["dAppRequestStore"]["setOnPermissionCallBack"]>();
    const invoke = (approved: boolean, record: ResponseRecorder) => {
      const callback: PermissionCallback | undefined =
        setCallback.mock.lastCall?.[0];
      if (!callback) throw new Error("The approval callback was never set");
      return callback(approved, record);
    };
    return { setCallback, invoke };
  };

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
    const copyButton = screen.getByRole("button", { name: "Copy Message" });
    expect(copyButton).toBeInTheDocument();
    expect(copyButton).toBeEnabled();
  });

  it("shows unprefixed hex verbatim, because that is what gets signed", async () => {
    // hashMessage hex-decodes only 0x-prefixed input, so this request signs
    // ten literal characters. Decoding it for display showed "Hello" over a
    // signature of "48656c6c6f".
    const unprefixedHex = "48656c6c6f";
    const signerAddress = toChecksumAddress(`Q${"a".repeat(128)}`);
    const sign = vi.fn<Sign>(() => ({
      signature: "0xsig",
      messageHash: "0xhash",
    }));
    const { setCallback, invoke } = capturePermission();

    const store = mockedStore({
      dAppRequestStore: {
        dAppRequestData: {
          params: [unprefixedHex, signerAddress],
        },
        setOnPermissionCallBack: setCallback,
      },
    });
    store.qrlStore.qrlInstance = createQrlInstance(signerAddress, sign);
    renderComponent(store);

    expect(screen.getByText(unprefixedHex)).toBeInTheDocument();
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();

    expect(setCallback).toHaveBeenCalledOnce();
    await act(async () => {
      await invoke(true, () => undefined);
    });

    // The displayed text and the signed payload are the same string.
    expect(sign).toHaveBeenCalledWith(unprefixedHex, expect.any(String));
  });

  it("still registers its signing callback while the node is unreachable", async () => {
    // Signing is local, and Approve was enabled whatever the connection
    // was doing. Registering the callback only while connected therefore
    // left the store's no-op default to answer the dApp with an empty
    // success during an outage.
    const signerAddress = toChecksumAddress(`Q${"a".repeat(128)}`);
    const sign = vi.fn<Sign>(() => ({
      signature: "0xsig",
      messageHash: "0xhash",
    }));
    const { setCallback, invoke } = capturePermission();
    const recorded: Record<string, unknown>[] = [];

    const store = mockedStore({
      qrlStore: {
        qrlConnection: { isConnected: false, isLoading: false },
      },
      dAppRequestStore: {
        dAppRequestData: {
          params: [message, signerAddress],
        },
        setOnPermissionCallBack: setCallback,
      },
    });
    store.qrlStore.qrlInstance = createQrlInstance(signerAddress, sign);
    renderComponent(store);

    expect(setCallback).toHaveBeenCalledOnce();
    await act(async () => {
      await invoke(true, (data) => {
        recorded.push(data);
      });
    });

    expect(sign).toHaveBeenCalled();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.signature).toBe("0xsig");
    expect(recorded[0]?.publicKey).toMatch(/^0x[0-9a-f]+$/);
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
    const clipboardMock = vi
      .fn<Clipboard["writeText"]>()
      .mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: clipboardMock,
      },
      writable: true,
    });
    const copyButton = screen.getByRole("button", { name: "Copy Message" });
    await userEvent.click(copyButton);
    expect(clipboardMock).toHaveBeenCalledTimes(1);
    expect(clipboardMock).toHaveBeenCalledWith(
      "Please sign this message to confirm your identity.",
    );
  });

  it("shows a translated message, re-polls lock state, and sends a stable 4100 error to the dApp when signing hits a locked wallet (L1)", async () => {
    const { setCallback, invoke } = capturePermission();
    const mockReadLockState = vi
      .fn<StoreType["lockStore"]["readLockState"]>()
      .mockResolvedValue(undefined);
    // The approval's own recorder: results go to the run that produced
    // them, never to whatever request the screen shows by then.
    const record = vi.fn<ResponseRecorder>();

    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [message, fromAddress],
          },
          setOnPermissionCallBack: setCallback,
        },
        lockStore: {
          getMnemonicPhrases: vi
            .fn<StoreType["lockStore"]["getMnemonicPhrases"]>()
            .mockRejectedValue(new Error("MyQRLWallet is locked")),
          readLockState: mockReadLockState,
        },
      }),
    );

    expect(setCallback).toHaveBeenCalledOnce();
    await act(async () => invoke(true, record));

    expect(
      screen.getByText("The wallet is locked. Unlock it to continue."),
    ).toBeInTheDocument();
    expect(mockReadLockState).toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith({
      error: objectContaining({
        code: 4100,
        message: "The wallet is locked",
      }),
    });
  });
  it.each([
    undefined,
    null,
    "message",
    [],
    [message],
    [42, fromAddress],
    [message, { address: fromAddress }],
    { 0: message },
  ])("refuses malformed signing parameters: %j", async (params: unknown) => {
    const { setCallback, invoke } = capturePermission();
    const setCanProceed =
      vi.fn<StoreType["dAppRequestStore"]["setCanProceed"]>();
    const getMnemonicPhrases =
      vi.fn<StoreType["lockStore"]["getMnemonicPhrases"]>();
    const record = vi.fn<ResponseRecorder>();
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: { params },
          setCanProceed,
          setOnPermissionCallBack: setCallback,
        },
        lockStore: { getMnemonicPhrases },
      }),
    );

    expect(setCanProceed).toHaveBeenLastCalledWith(false);
    await act(async () => {
      await invoke(true, record);
    });
    expect(record).toHaveBeenCalledWith({
      error: objectContaining({ code: -32602 }),
    });
    expect(getMnemonicPhrases).not.toHaveBeenCalled();
  });

  it.each(["", "visible\u200bmessage"])(
    "signs the original message from indexed parameters: %j",
    async (rawMessage) => {
      const { setCallback, invoke } = capturePermission();
      const signerAddress = toChecksumAddress(`Q${"a".repeat(128)}`);
      const sign = vi.fn<Sign>(() => ({
        signature: "0xsig",
        messageHash: "0xhash",
      }));
      const record = vi.fn<ResponseRecorder>();
      const store = mockedStore({
        dAppRequestStore: {
          dAppRequestData: { params: { 0: rawMessage, 1: signerAddress } },
          setOnPermissionCallBack: setCallback,
        },
      });
      store.qrlStore.qrlInstance = createQrlInstance(signerAddress, sign);
      renderComponent(store);

      await act(async () => {
        await invoke(true, record);
      });
      expect(sign).toHaveBeenCalledWith(rawMessage, EXTENDED_SEED);
      expect(record.mock.lastCall?.[0].signature).toBe("0xsig");
    },
  );

  it("disables approval when valid parameters are replaced with malformed data", () => {
    const setCanProceed =
      vi.fn<StoreType["dAppRequestStore"]["setCanProceed"]>();
    const store = mockedStore({
      dAppRequestStore: {
        dAppRequestData: { params: [message, fromAddress] },
        setCanProceed,
      },
    });
    const view = renderComponent(store);
    expect(setCanProceed).toHaveBeenLastCalledWith(true);
    const nextStore = mockedStore({
      dAppRequestStore: {
        dAppRequestData: { params: [message, null] },
        setCanProceed,
      },
    });
    view.rerender(
      <StoreProvider value={nextStore}>
        <MemoryRouter>
          <TooltipProvider>
            <PersonalSign />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );
    expect(setCanProceed).toHaveBeenLastCalledWith(false);
  });

  it.each([null, {}, { signature: 12 }, { signature: "" }])(
    "refuses malformed signing results: %j",
    async (result) => {
      const { setCallback, invoke } = capturePermission();
      const signerAddress = toChecksumAddress(`Q${"a".repeat(128)}`);
      const sign = vi
        .fn<Sign>()
        .mockReturnValue(malformed<ReturnType<Sign>>(result));
      const record = vi.fn<ResponseRecorder>();
      const store = mockedStore({
        dAppRequestStore: {
          dAppRequestData: { params: [message, signerAddress] },
          setOnPermissionCallBack: setCallback,
        },
      });
      store.qrlStore.qrlInstance = createQrlInstance(signerAddress, sign);
      renderComponent(store);

      await act(async () => {
        await invoke(true, record);
      });
      expect(record).toHaveBeenCalledWith({
        error: new Error("Message data could not be signed"),
      });
    },
  );

  it("reports a clipboard rejection", async () => {
    const failure = new Error("Clipboard permission denied");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeText = vi
      .fn<Clipboard["writeText"]>()
      .mockRejectedValue(failure);
    Object.assign(navigator, { clipboard: { writeText } });
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: { params: [message, fromAddress] },
        },
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Copy Message" }));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to copy the signing message:",
        failure,
      );
    });
  });
});
