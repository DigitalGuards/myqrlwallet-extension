import { mockedStore } from "@/__mocks__/mockedStore";
import { RESTRICTED_METHODS } from "@/scripts/constants/requestConstants";
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
  revalidateAuthorizedDAppRequest: vi.fn(async () => ({
    canProceed: true,
    proceedError: undefined,
  })),
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

describe("QrlPqSign", () => {
  afterEach(cleanup);

  const signerAddress = toChecksumAddress(`Q${"a".repeat(128)}`);
  const message = "0x48656c6c6f";

  it("still registers its signing callback while the node is unreachable", async () => {
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
        value={mockedStore({
          qrlStore: {
            qrlConnection: { isConnected: false, isLoading: false },
            qrlInstance: {
              accounts: {
                seedToAccount: () => ({ address: signerAddress }),
              },
            } as never,
          },
          dAppRequestStore: {
            dAppRequestData: {
              method: RESTRICTED_METHODS.QRL_SIGN_MESSAGE,
              params: [signerAddress, message],
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

    expect(capturedPermissionCallback).not.toBeNull();
    await act(async () => {
      await capturedPermissionCallback!(true, (data) => {
        recorded.push(data);
      });
    });

    expect(mockSignMessage).toHaveBeenCalled();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ signature: "0xsig" });
  });

  it.each(canonical.schemeSigningVectors)(
    "signs qrl_signTypedData under the payload's scheme: $label",
    async (vector) => {
      seedRef.value = vector.hexSeed;
      let capturedPermissionCallback:
        | ((hasApproved: boolean, record: ResponseRecorder) => Promise<void>)
        | null = null;
      const recorded: Record<string, unknown>[] = [];

      render(
        <StoreProvider
          value={mockedStore({
            qrlStore: {
              qrlInstance: {
                accounts: {
                  seedToAccount: () => ({ address: vector.signer }),
                },
              } as never,
            },
            dAppRequestStore: {
              dAppRequestData: {
                method: RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA,
                params: [vector.signer, vector.payload],
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

      await act(async () => {
        await capturedPermissionCallback!(true, (data) => {
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
});
