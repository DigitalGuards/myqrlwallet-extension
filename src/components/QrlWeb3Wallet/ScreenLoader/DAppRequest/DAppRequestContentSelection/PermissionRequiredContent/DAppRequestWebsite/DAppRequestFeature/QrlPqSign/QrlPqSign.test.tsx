import Web3 from "@theqrl/web3";
import { mockedStore } from "@/__mocks__/mockedStore";
import { RESTRICTED_METHODS } from "@/scripts/constants/requestConstants";
import type DAppRequestStore from "@/stores/dAppRequestStore";
import type LockStore from "@/stores/lockStore";
import { screen } from "@testing-library/react";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";
import { StoreProvider } from "@/stores/store";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { act, cleanup, render } from "@testing-library/react";
import { toChecksumAddress } from "@theqrl/wallet.js";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import canonical from "@/functions/pqSigning/__fixtures__/canonical.json";
import QrlPqSign from "./QrlPqSign";

const { seedRef } = vi.hoisted(() => ({
  seedRef: { value: `0x${"ab".repeat(51)}` },
}));

vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: () => seedRef.value,
}));

vi.mock("@/scripts/utils/restrictedMethodsMiddlewareUtils", () => ({
  revalidateAuthorizedDAppRequest: vi.fn().mockResolvedValue({
    canProceed: true,
    proceedError: undefined,
  }),
}));

const { mockSignMessage } = vi.hoisted(() => ({
  mockSignMessage: vi.fn(() => ({
    signature: "0xsig",
    publicKey: "0xpub",
    descriptor: "0xdesc",
    signer: "Qsigner",
    digest: "0xdigest",
    schemeVersion: 1,
  })),
}));

vi.mock("@/functions/pqSigning", async () => {
  const actual = await vi.importActual<typeof import("@/functions/pqSigning")>(
    "@/functions/pqSigning",
  );
  return { ...actual, signMessage: mockSignMessage };
});

const signingStore = (
  address: string,
  overrides: Parameters<typeof mockedStore>[0],
) => {
  const store = mockedStore(overrides);
  const instance = new Web3().qrl;
  const account = instance.accounts.seedToAccount(
    canonical.signingVectors[0].hexSeed,
  );
  vi.spyOn(instance.accounts, "seedToAccount").mockReturnValue({
    ...account,
    address,
  });
  store.qrlStore.qrlInstance = instance;
  return store;
};

describe("QrlPqSign", () => {
  afterEach(cleanup);

  const signerAddress = toChecksumAddress(`Q${"a".repeat(128)}`);
  const message = "0x48656c6c6f";

  it.each([
    { format: "array", params: [signerAddress, message] },
    { format: "indexed object", params: { 0: signerAddress, 1: message } },
  ])(
    "displays and signs $format message parameters while the node is unreachable",
    async ({ params }) => {
      // Signing is local, and Approve was enabled whatever the connection
      // was doing. Registering the callback only while connected therefore
      // left the store's no-op default to answer the dApp with an empty
      // success during an outage.
      let capturedPermissionCallback:
        | ((hasApproved: boolean, record: ResponseRecorder) => Promise<void>)
        | null = null;
      const recorded: Record<string, unknown>[] = [];

      render(
        <StoreProvider
          value={signingStore(signerAddress, {
            qrlStore: {
              qrlConnection: { isConnected: false, isLoading: false },
            },
            dAppRequestStore: {
              dAppRequestData: {
                method: RESTRICTED_METHODS.QRL_SIGN_MESSAGE,
                params,
              },
              setOnPermissionCallBack: (
                callback: (
                  hasApproved: boolean,
                  record: ResponseRecorder,
                ) => Promise<void>,
              ) => {
                capturedPermissionCallback = callback;
              },
            },
          })}
        >
          <MemoryRouter>
            <TooltipProvider>
              <QrlPqSign />
            </TooltipProvider>
          </MemoryRouter>
        </StoreProvider>,
      );

      expect(screen.getByTitle(signerAddress)).toBeInTheDocument();
      expect(screen.getByText("Hello")).toBeInTheDocument();
      expect(capturedPermissionCallback).not.toBeNull();
      await act(async () => {
        if (!capturedPermissionCallback)
          throw new Error("Missing permission callback");
        await capturedPermissionCallback(true, (data) => {
          recorded.push(data);
        });
      });

      expect(mockSignMessage).toHaveBeenCalledExactlyOnceWith(
        message,
        seedRef.value,
      );
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({ signature: "0xsig" });
    },
  );

  it.each(
    canonical.schemeSigningVectors.flatMap((vector) => [
      { ...vector, format: "array", params: [vector.signer, vector.payload] },
      {
        ...vector,
        format: "indexed object",
        params: { 0: vector.signer, 1: vector.payload },
      },
    ]),
  )(
    "displays and signs $format qrl_signTypedData parameters under the payload's scheme: $label",
    async (vector) => {
      seedRef.value = vector.hexSeed;
      let capturedPermissionCallback:
        | ((hasApproved: boolean, record: ResponseRecorder) => Promise<void>)
        | null = null;
      const recorded: Record<string, unknown>[] = [];

      render(
        <StoreProvider
          value={signingStore(vector.signer, {
            dAppRequestStore: {
              dAppRequestData: {
                method: RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA,
                params: vector.params,
              },
              setOnPermissionCallBack: (
                callback: (
                  hasApproved: boolean,
                  record: ResponseRecorder,
                ) => Promise<void>,
              ) => {
                capturedPermissionCallback = callback;
              },
            },
          })}
        >
          <MemoryRouter>
            <TooltipProvider>
              <QrlPqSign />
            </TooltipProvider>
          </MemoryRouter>
        </StoreProvider>,
      );

      expect(screen.getByTitle(vector.signer)).toBeInTheDocument();
      expect(
        screen.getByText(
          `${vector.payload.domain.name} · ${vector.payload.primaryType}`,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(vector.payload.domain.chainId),
      ).toBeInTheDocument();
      expect(
        screen.getByText(JSON.stringify(vector.payload.message, null, 2), {
          normalizer: (text) => text,
        }),
      ).toBeInTheDocument();
      if (vector.payload.domain.verifyingContract) {
        expect(
          screen.getByTitle(vector.payload.domain.verifyingContract),
        ).toBeInTheDocument();
      }

      await act(async () => {
        if (!capturedPermissionCallback)
          throw new Error("Missing permission callback");
        await capturedPermissionCallback(true, (data) => {
          recorded.push(data);
        });
      });

      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        digest: vector.digest,
        schemeVersion: vector.schemeVersion,
        signer: vector.signer,
      });
      expect(recorded[0]?.error).toBeUndefined();
      seedRef.value = `0x${"ab".repeat(51)}`;
    },
  );

  it.each([
    { method: RESTRICTED_METHODS.QRL_SIGN_MESSAGE, params: undefined },
    {
      method: RESTRICTED_METHODS.QRL_SIGN_MESSAGE,
      params: null,
    },
    {
      method: RESTRICTED_METHODS.QRL_SIGN_MESSAGE,
      params: { 1: message },
    },
    {
      method: RESTRICTED_METHODS.QRL_SIGN_MESSAGE,
      params: { 0: signerAddress, 1: {} },
    },
    { method: RESTRICTED_METHODS.QRL_SIGN_MESSAGE, params: [42, message] },
    {
      method: RESTRICTED_METHODS.QRL_SIGN_MESSAGE,
      params: [signerAddress, {}],
    },
    {
      method: RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA,
      params: [signerAddress, null],
    },
    {
      method: RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA,
      params: [signerAddress, { domain: {}, primaryType: {} }],
    },
  ])(
    "records an error for malformed signing parameters: %j",
    async ({ method, params }) => {
      const setOnPermissionCallBack =
        vi.fn<DAppRequestStore["setOnPermissionCallBack"]>();
      const getMnemonicPhrases = vi
        .fn<LockStore["getMnemonicPhrases"]>()
        .mockResolvedValue("test mnemonic");
      const store = signingStore(signerAddress, {
        lockStore: { getMnemonicPhrases },
        dAppRequestStore: {
          dAppRequestData: { method, params },
          setOnPermissionCallBack,
        },
      });
      render(
        <StoreProvider value={store}>
          <TooltipProvider>
            <QrlPqSign />
          </TooltipProvider>
        </StoreProvider>,
      );
      const registration = setOnPermissionCallBack.mock.calls.at(0);
      if (!registration) throw new Error("Missing signing callback");
      const [callback] = registration;
      const record = vi.fn<ResponseRecorder>();
      await act(async () => {
        await callback(true, record);
      });
      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0]?.[0].error).toBeInstanceOf(Error);
      expect(mockSignMessage).not.toHaveBeenCalled();
      if (method === RESTRICTED_METHODS.QRL_SIGN_MESSAGE) {
        expect(getMnemonicPhrases).not.toHaveBeenCalled();
      }
    },
  );

  it("shows only scalar values for typed-data domain identity", () => {
    const store = mockedStore({
      dAppRequestStore: {
        dAppRequestData: {
          method: RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA,
          params: [
            signerAddress,
            {
              types: {},
              primaryType: "Message",
              domain: { name: {}, chainId: {}, verifyingContract: {} },
              message: {},
            },
          ],
        },
      },
    });
    render(
      <StoreProvider value={store}>
        <TooltipProvider>
          <QrlPqSign />
        </TooltipProvider>
      </StoreProvider>,
    );
    expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
    expect(screen.getByText(/Message/)).toBeInTheDocument();
  });
});
