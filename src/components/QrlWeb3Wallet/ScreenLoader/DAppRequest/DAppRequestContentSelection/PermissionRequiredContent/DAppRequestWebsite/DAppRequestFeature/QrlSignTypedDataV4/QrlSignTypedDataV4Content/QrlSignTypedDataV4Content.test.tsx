import { mockedStore } from "@/__mocks__/mockedStore";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";
import { StoreProvider, type StoreType } from "@/stores/store";
import Web3 from "@theqrl/web3";
import * as signing from "@theqrl/web3-qrl-accounts";
import { getEncodedEip712Data } from "@theqrl/web3-qrl-abi";
import { providerErrors } from "@theqrl/qrl-wallet-provider";
import { revalidateAuthorizedDAppRequest } from "@/scripts/utils/restrictedMethodsMiddlewareUtils";
import { malformed } from "@/test-utils/malformed";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/UI/Tooltip";
import QrlSignTypedDataV4Content from "./QrlSignTypedDataV4Content";

const EXTENDED_SEED =
  "0x0100000580a227e1b6d5a89df7723a71e9c03535e9447ec6d160b68c0ba845c68a05c59226cce711eb3db312c022ccf9577be7";
const signingPayload = {
  types: { EIP712Domain: [], Permit: [{ name: "value", type: "uint256" }] },
  primaryType: "Permit",
  domain: {},
  message: { value: "42" },
};

vi.mock("@theqrl/web3-qrl-accounts", async (importOriginal) => {
  const original = await importOriginal<typeof signing>();
  return { ...original, sign: vi.fn(original.sign) };
});
vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: () => EXTENDED_SEED,
}));
vi.mock("@/scripts/utils/restrictedMethodsMiddlewareUtils", () => ({
  revalidateAuthorizedDAppRequest: vi.fn(() =>
    Promise.resolve({ canProceed: true, proceedError: undefined }),
  ),
}));

const capturePermission = () => {
  const setCallback =
    vi.fn<StoreType["dAppRequestStore"]["setOnPermissionCallBack"]>();
  const invoke = (approved: boolean, record: ResponseRecorder) => {
    const callback = setCallback.mock.lastCall?.[0];
    if (!callback) throw new Error("The approval callback was never set");
    return callback(approved, record);
  };
  return { setCallback, invoke };
};

describe("QrlSignTypedDataV4Content", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.mocked(signing.sign).mockReset();
  });

  const fromAddress = "Q20D20b8026B8F02540246f58120ddAAf35AECD9B";
  const msgParams = {
    types: {
      EIP712Domain: [
        {
          name: "name",
          type: "string",
        },
        {
          name: "version",
          type: "string",
        },
        {
          name: "chainId",
          type: "uint256",
        },
        {
          name: "verifyingContract",
          type: "address",
        },
      ],
      Person: [
        {
          name: "name",
          type: "string",
        },
        {
          name: "wallet",
          type: "address",
        },
      ],
      Mail: [
        {
          name: "from",
          type: "Person",
        },
        {
          name: "to",
          type: "Person",
        },
        {
          name: "contents",
          type: "string",
        },
      ],
    },
    primaryType: "Mail",
    domain: {
      name: "Ether Mail",
      version: "1",
      chainId: 1,
      verifyingContract: "QCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
    },
    message: {
      from: {
        name: "Cow",
        wallet: "QCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826",
      },
      to: {
        name: "Bob",
        wallet: "QbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
      },
      contents: "Hello, Bob!",
    },
  };

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <QrlSignTypedDataV4Content />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("still registers its signing callback while the node is unreachable", async () => {
    // Signing is local, and Approve was enabled whatever the connection
    // was doing. Registering the callback only while connected left the
    // store's no-op default to answer the dApp with an empty success.
    const { setCallback, invoke } = capturePermission();
    const recorded: Record<string, unknown>[] = [];
    vi.mocked(signing.sign).mockReturnValueOnce({
      signature: "0xabcd",
      messageHash: "0xhash",
    });
    const instance = new Web3().qrl;
    const signer = instance.accounts.seedToAccount(EXTENDED_SEED).address;
    const store = mockedStore({
      qrlStore: {
        qrlConnection: { isConnected: false, isLoading: false },
      },
      dAppRequestStore: {
        dAppRequestData: { params: [signer, signingPayload] },
        setOnPermissionCallBack: setCallback,
      },
    });
    store.qrlStore.qrlInstance = instance;
    renderComponent(store);

    expect(setCallback).toHaveBeenCalledOnce();
    await act(async () => {
      await invoke(true, (data) => {
        recorded.push(data);
      });
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.error).toBeUndefined();
    expect(signing.sign).toHaveBeenCalledWith(
      getEncodedEip712Data(signingPayload, true),
      EXTENDED_SEED,
    );
    expect(recorded[0]?.signature).toBe("0xabcd");
    expect(recorded[0]?.publicKey).toMatch(/^0x[0-9a-f]+$/);
  });

  it("should render the qrl sign typed data v4 content component", () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [fromAddress, msgParams],
          },
        },
      }),
    );

    // Header / from-account
    expect(screen.getByText("From Address")).toBeInTheDocument();
    expect(
      screen.getByText("Q 20D20 b8026 B8F02 54024 6f581 20ddA Af35A ECD9B"),
    ).toBeInTheDocument();

    // Domain accordion: Name, Version, Chain ID, Verifying Contract are
    // each labelled and rendered (F-6).
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Ether Mail")).toBeInTheDocument();
    expect(screen.getByText("Version")).toBeInTheDocument();
    expect(screen.getByText("Chain ID")).toBeInTheDocument();
    expect(screen.getByText("Verifying Contract")).toBeInTheDocument();
    expect(
      screen.getByText("Q CcCCc cccCC CCcCC CCCCc CcCcc CcCCC cCccc ccccC"),
    ).toBeInTheDocument();

    // Message accordion: structured-data banner + primary type
    expect(screen.getByText(/Structured-data signature/i)).toBeInTheDocument();
    expect(screen.getByText("Primary Type")).toBeInTheDocument();
    expect(screen.getByText("Mail")).toBeInTheDocument();

    // Recursive rendering includes nested structs (from / to) and uses
    // the dApp-supplied keys verbatim. This is
    // the F-6 fix: previously only the hardcoded "Mail"-schema fields were
    // shown, leaving Permit / Permit2 / Seaport schemas blank.
    expect(screen.getByText("contents")).toBeInTheDocument();
    expect(screen.getByText("Hello, Bob!")).toBeInTheDocument();
    expect(screen.getByText("from")).toBeInTheDocument();
    expect(screen.getByText("to")).toBeInTheDocument();
    expect(screen.getByText("Cow")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(
      screen.getByText("QCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("QbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"),
    ).toBeInTheDocument();

    const copyButton = screen.getByRole("button", {
      name: "Copy message data",
    });
    expect(copyButton).toBeInTheDocument();
    expect(copyButton).toBeEnabled();
  });

  it("should shrink the expandable section on clicking", async () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [fromAddress, msgParams],
          },
        },
      }),
    );

    const accordionForDomain = screen.getByRole("button", { name: "Domain" });
    expect(accordionForDomain).toBeInTheDocument();
    expect(accordionForDomain).toBeEnabled();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Ether Mail")).toBeInTheDocument();
    expect(screen.getByText("Verifying Contract")).toBeInTheDocument();

    await userEvent.click(accordionForDomain);
    expect(screen.queryByText("Name")).not.toBeInTheDocument();
    expect(screen.queryByText("Ether Mail")).not.toBeInTheDocument();
    expect(screen.queryByText("Verifying Contract")).not.toBeInTheDocument();

    const accordionForMessage = screen.getByRole("button", { name: "Message" });
    expect(accordionForMessage).toBeInTheDocument();
    expect(accordionForMessage).toBeEnabled();
    expect(screen.getByText("Primary Type")).toBeInTheDocument();
    expect(screen.getByText("Mail")).toBeInTheDocument();
    expect(screen.getByText("contents")).toBeInTheDocument();
    expect(screen.getByText("Hello, Bob!")).toBeInTheDocument();
    expect(screen.getByText("from")).toBeInTheDocument();
    expect(screen.getByText("to")).toBeInTheDocument();
    expect(screen.getByText("Cow")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    await userEvent.click(accordionForMessage);
    expect(screen.queryByText("Primary Type")).not.toBeInTheDocument();
    expect(screen.queryByText("contents")).not.toBeInTheDocument();
    expect(screen.queryByText("Hello, Bob!")).not.toBeInTheDocument();
    expect(screen.queryByText("from")).not.toBeInTheDocument();
    expect(screen.queryByText("to")).not.toBeInTheDocument();
    expect(screen.queryByText("Cow")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("should copy the message data to clipboard", async () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [fromAddress, msgParams],
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
    const copyButton = screen.getByRole("button", {
      name: "Copy message data",
    });
    await userEvent.click(copyButton);
    expect(clipboardMock).toHaveBeenCalledTimes(1);
    expect(clipboardMock).toHaveBeenCalledWith(
      '{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],"Person":[{"name":"name","type":"string"},{"name":"wallet","type":"address"}],"Mail":[{"name":"from","type":"Person"},{"name":"to","type":"Person"},{"name":"contents","type":"string"}]},"primaryType":"Mail","domain":{"name":"Ether Mail","version":"1","chainId":1,"verifyingContract":"QCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC"},"message":{"from":{"name":"Cow","wallet":"QCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826"},"to":{"name":"Bob","wallet":"QbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"},"contents":"Hello, Bob!"}}',
    );
  });

  it.each(
    [
      undefined,
      null,
      "params",
      [],
      [12, signingPayload],
      [fromAddress, null],
      [
        fromAddress,
        { ...signingPayload, types: { EIP712Domain: [], Permit: [null] } },
      ],
      [fromAddress, { ...signingPayload, types: {} }],
      [fromAddress, { ...signingPayload, primaryType: {} }],
      [fromAddress, { ...signingPayload, domain: [] }],
      [fromAddress, { ...signingPayload, domain: { name: {} } }],
      [fromAddress, { ...signingPayload, domain: { verifyingContract: 12 } }],
      [fromAddress, { ...signingPayload, message: [] }],
    ].map((params) => ({ params })),
  )("refuses malformed typed-data parameters: %j", async ({ params }) => {
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
          setOnPermissionCallBack: setCallback,
          setCanProceed,
        },
        lockStore: { getMnemonicPhrases },
      }),
    );

    expect(setCanProceed).toHaveBeenLastCalledWith(false);
    await act(async () => {
      await invoke(true, record);
    });
    expect(record.mock.lastCall?.[0].error).toMatchObject({ code: -32602 });
    expect(getMnemonicPhrases).not.toHaveBeenCalled();
    expect(revalidateAuthorizedDAppRequest).not.toHaveBeenCalled();
  });

  it("keeps indexed payloads, approval summaries, and chain warnings", () => {
    const setCanProceed =
      vi.fn<StoreType["dAppRequestStore"]["setCanProceed"]>();
    renderComponent(
      mockedStore({
        qrlStore: { qrlConnection: { blockchain: { chainId: "0x2" } } },
        dAppRequestStore: {
          setCanProceed,
          dAppRequestData: {
            params: {
              0: fromAddress,
              1: {
                ...signingPayload,
                domain: {
                  name: "Token",
                  version: 2,
                  chainId: "0x1",
                  salt: "salt",
                },
                message: {
                  spender: "recipient",
                  value: ((1n << 256n) - 1n).toString(),
                  deadline: "123",
                  nested: [true, 12, "visible\u200btext"],
                },
              },
            },
          },
        },
      }),
    );
    expect(setCanProceed).toHaveBeenLastCalledWith(true);
    expect(screen.getAllByText("recipient")).toHaveLength(2);
    expect(screen.getByText("unlimited (uint256 max)")).toBeInTheDocument();
    expect(screen.getByText("123")).toBeInTheDocument();
    expect(screen.getByText("12 (0xc)")).toBeInTheDocument();
    expect(
      screen.getByText(/hidden formatting characters removed/),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not match/i)).toBeInTheDocument();
  });

  it("disables approval when the request becomes malformed", () => {
    const setCanProceed =
      vi.fn<StoreType["dAppRequestStore"]["setCanProceed"]>();
    const view = renderComponent(
      mockedStore({
        dAppRequestStore: {
          setCanProceed,
          dAppRequestData: { params: [fromAddress, signingPayload] },
        },
      }),
    );
    expect(setCanProceed).toHaveBeenLastCalledWith(true);
    view.rerender(
      <StoreProvider
        value={mockedStore({
          dAppRequestStore: {
            setCanProceed,
            dAppRequestData: { params: null },
          },
        })}
      >
        <MemoryRouter>
          <TooltipProvider>
            <QrlSignTypedDataV4Content />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );
    expect(setCanProceed).toHaveBeenLastCalledWith(false);
  });

  it.each([
    { allowed: true, amount: "1 (0x1)" },
    { allowed: false, amount: "0 (0x0)" },
  ])("preserves boolean approval amounts: $allowed", ({ allowed, amount }) => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [
              fromAddress,
              {
                ...signingPayload,
                message: { allowed, validBefore: null },
              },
            ],
          },
        },
      }),
    );
    expect(screen.getByText(amount)).toBeInTheDocument();
    expect(screen.getAllByText("null")).toHaveLength(2);
  });

  it("preserves authorization errors before reading a key or signing", async () => {
    const { setCallback, invoke } = capturePermission();
    const record = vi.fn<ResponseRecorder>();
    const getMnemonicPhrases =
      vi.fn<StoreType["lockStore"]["getMnemonicPhrases"]>();
    const proceedError = providerErrors.unauthorized({
      message: "Account authorization changed",
    });
    vi.mocked(revalidateAuthorizedDAppRequest).mockResolvedValueOnce({
      canProceed: false,
      proceedError,
    });
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: { params: [fromAddress, signingPayload] },
          setOnPermissionCallBack: setCallback,
        },
        lockStore: { getMnemonicPhrases },
      }),
    );
    await act(async () => {
      await invoke(true, record);
    });
    expect(record).toHaveBeenCalledWith({ error: proceedError });
    expect(getMnemonicPhrases).not.toHaveBeenCalled();
    expect(signing.sign).not.toHaveBeenCalled();
  });

  it.each([null, {}, { signature: 12 }, { signature: "" }])(
    "refuses malformed library signatures: %j",
    async (result) => {
      vi.mocked(signing.sign).mockReturnValueOnce(malformed(result));
      const { setCallback, invoke } = capturePermission();
      const instance = new Web3().qrl;
      const signer = instance.accounts.seedToAccount(EXTENDED_SEED).address;
      const record = vi.fn<ResponseRecorder>();
      const store = mockedStore({
        dAppRequestStore: {
          dAppRequestData: { params: [signer, signingPayload] },
          setOnPermissionCallBack: setCallback,
        },
      });
      store.qrlStore.qrlInstance = instance;
      renderComponent(store);
      await act(async () => {
        await invoke(true, record);
      });
      expect(record.mock.lastCall?.[0].error).toEqual(
        new Error("Message data could not be signed"),
      );
    },
  );

  it("preserves the locked-wallet response and refreshes lock state", async () => {
    const { setCallback, invoke } = capturePermission();
    const record = vi.fn<ResponseRecorder>();
    const readLockState = vi
      .fn<StoreType["lockStore"]["readLockState"]>()
      .mockResolvedValue(undefined);
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: { params: [fromAddress, signingPayload] },
          setOnPermissionCallBack: setCallback,
        },
        lockStore: {
          readLockState,
          getMnemonicPhrases: vi
            .fn<StoreType["lockStore"]["getMnemonicPhrases"]>()
            .mockRejectedValue(new Error("MyQRLWallet is locked")),
        },
      }),
    );
    await act(async () => {
      await invoke(true, record);
    });
    expect(record.mock.lastCall?.[0].error).toMatchObject({
      code: 4100,
      message: "The wallet is locked",
    });
    expect(readLockState).toHaveBeenCalledOnce();
    expect(
      screen.getByText("The wallet is locked. Unlock it to continue."),
    ).toBeInTheDocument();
  });
});
