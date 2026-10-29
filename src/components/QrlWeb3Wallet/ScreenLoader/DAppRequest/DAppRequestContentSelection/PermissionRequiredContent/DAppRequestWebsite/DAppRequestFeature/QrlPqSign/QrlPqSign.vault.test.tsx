import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Web3 from "@theqrl/web3";
import { providerErrors } from "@theqrl/qrl-wallet-provider";
import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import type DAppRequestStore from "@/stores/dAppRequestStore";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";
import type { DAppRequestType } from "@/scripts/middlewares/middlewareTypes";
import { TooltipProvider } from "@/components/UI/Tooltip";
import { RESTRICTED_METHODS } from "@/scripts/constants/requestConstants";
import { revalidateAuthorizedDAppRequest } from "@/scripts/utils/restrictedMethodsMiddlewareUtils";
import * as signing from "@/functions/pqSigning";
import * as policy from "@/functions/pqSigning/quantaVaultApproval";
import {
  vaultPayload,
  vaultTestAddress,
  vaultCalldata,
  vaultReviewTime,
} from "@/functions/pqSigning/__tests__/quantaVaultFixtures";
import canonical from "@/functions/pqSigning/__fixtures__/canonical.json";
import {
  TYPED_DATA_LIMITS,
  type TypedDataPayload,
} from "@/functions/pqSigning";
import { isRecord } from "@/utilities/storageGuards";
import StorageUtil from "@/utilities/storageUtil";
import { toCanonicalQrlAddress } from "@/utilities/addressUtil";
import QrlPqSign from "./QrlPqSign";

vi.mock("@/scripts/utils/restrictedMethodsMiddlewareUtils", () => ({
  revalidateAuthorizedDAppRequest: vi
    .fn()
    .mockResolvedValue({ canProceed: true }),
}));
vi.mock("@/functions/getHexSeedFromMnemonic", () => ({
  getHexSeedFromMnemonic: () => canonical.signingVectors[0].hexSeed,
}));
vi.mock("@/functions/pqSigning", async () => {
  const actual = await vi.importActual<typeof import("@/functions/pqSigning")>(
    "@/functions/pqSigning",
  );
  return { ...actual, signTypedData: vi.fn(() => ({ signature: "0xsigned" })) };
});

function transaction(payload: TypedDataPayload): Record<string, unknown> {
  const tx =
    payload.primaryType === "VaultApproval"
      ? payload.message.tx
      : payload.message;
  if (!isRecord(tx)) throw new Error("Missing fixture transaction");
  return tx;
}

function requestFor(payload: unknown): DAppRequestType {
  return {
    method: RESTRICTED_METHODS.QRL_SIGN_TYPED_DATA,
    params: [canonical.signingVectors[0].signer, payload],
    authorizedChainId: "0x1",
    requestData: { senderData: { url: "https://quantavault.io/vault" } },
  };
}

function harness(payload: unknown) {
  const setCanProceed = vi.fn<DAppRequestStore["setCanProceed"]>();
  const register = vi.fn<DAppRequestStore["setOnPermissionCallBack"]>();
  const getMnemonicPhrases = vi.fn().mockResolvedValue("fixture mnemonic");
  const store = mockedStore({
    lockStore: { getMnemonicPhrases },
    dAppRequestStore: {
      dAppRequestData: requestFor(payload),
      setCanProceed,
      setOnPermissionCallBack: register,
    },
  });
  store.qrlStore.qrlInstance = new Web3().qrl;
  const tree = () => (
    <StoreProvider value={Object.assign({}, store)}>
      <TooltipProvider>
        <QrlPqSign />
      </TooltipProvider>
    </StoreProvider>
  );
  const view = render(tree());
  return {
    ...view,
    store,
    setCanProceed,
    getMnemonicPhrases,
    replace(request: DAppRequestType) {
      store.dAppRequestStore.dAppRequestData = request;
      view.rerender(tree());
    },
    async approve() {
      const callback = register.mock.calls.at(-1)?.[0];
      if (!callback) throw new Error("Missing permission callback");
      const record = vi.fn<ResponseRecorder>();
      await act(async () => {
        await callback(true, record);
      });
      return record;
    },
  };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Number(vaultReviewTime) * 1000);
  vi.spyOn(StorageUtil, "getTokenContractsList").mockResolvedValue([]);
  vi.mocked(revalidateAuthorizedDAppRequest).mockResolvedValue({
    canProceed: true,
    proceedError: undefined,
    authorizedChainId: "0x1",
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const refunds = ["empty-call", "approval-empty"].flatMap((label) =>
  ["baseGas", "gasPrice", "gasToken", "refundReceiver"].map((field) => ({
    label,
    field,
  })),
);
function refundPayload(label: string, field: string) {
  const payload = vaultPayload(label);
  transaction(payload)[field] =
    field === "gasToken" || field === "refundReceiver"
      ? vaultTestAddress
      : "0x1";
  return payload;
}

describe("vault approval state", () => {
  it.each(refunds)(
    "disables $label for nonzero $field and displays the blocking error",
    ({ label, field }) => {
      const view = harness(refundPayload(label, field));
      expect(view.setCanProceed).toHaveBeenLastCalledWith(false);
      expect(screen.getByText(/Refund fields must be zero/)).toHaveAttribute(
        "role",
        "alert",
      );
      expect(view.getMnemonicPhrases).not.toHaveBeenCalled();
    },
  );

  it("recomputes approval on every side panel request, including parse failures and recovery", () => {
    const view = harness(vaultPayload());
    expect(view.setCanProceed).toHaveBeenLastCalledWith(true);
    view.replace(requestFor(refundPayload("approval-empty", "gasPrice")));
    expect(view.setCanProceed).toHaveBeenLastCalledWith(false);
    view.replace(requestFor(null));
    expect(view.setCanProceed).toHaveBeenLastCalledWith(false);
    expect(screen.getByText(/payload could not be parsed/)).toBeInTheDocument();
    const generic = vaultPayload();
    generic.domain.name = "Another app";
    view.replace(requestFor(generic));
    expect(view.setCanProceed).toHaveBeenLastCalledWith(true);
    view.replace(requestFor(vaultPayload("approval-empty")));
    expect(view.setCanProceed).toHaveBeenLastCalledWith(true);
    view.replace({
      method: RESTRICTED_METHODS.QRL_SIGN_MESSAGE,
      params: [vaultTestAddress, "0x1234"],
    });
    expect(view.setCanProceed).toHaveBeenLastCalledWith(true);
  });

  it("applies the typed-data parser's limits before attempting recognition", () => {
    const payload = vaultPayload();
    payload.types.VaultTx = Array.from(
      { length: TYPED_DATA_LIMITS.maxFieldsPerType + 1 },
      () => ({ name: "to", type: "address" }),
    );
    const view = harness(payload);
    expect(view.setCanProceed).toHaveBeenLastCalledWith(false);
    expect(screen.queryByTestId("vault-review")).not.toBeInTheDocument();
  });

  it("keeps a QuantaVault schema mismatch in the generic view with a warning", () => {
    const payload = vaultPayload();
    payload.domain.version = "2";
    harness(payload);
    expect(screen.queryByTestId("vault-review")).not.toBeInTheDocument();
    expect(
      screen.getByText(/does not match its exact signing schema/),
    ).toHaveAttribute("role", "alert");
    expect(screen.getByText("QuantaVault · VaultTx")).toBeInTheDocument();
  });

  it("keeps raw message JSON collapsed under the decoded review", () => {
    const payload = vaultPayload();
    const view = harness(payload);
    const details = view.container.querySelector("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent('"nonce"');
    fireEvent.click(screen.getByText("Raw message JSON"));
    expect(details).toHaveAttribute("open");
  });
});

describe("vault permission callback", () => {
  it.each(refunds)(
    "refuses $label with $field through a provider error before unlocking",
    async ({ label, field }) => {
      const view = harness(refundPayload(label, field));
      const order = vi.spyOn(policy, "assertVaultRequestSignable");
      const record = await view.approve();
      expect(revalidateAuthorizedDAppRequest).toHaveBeenCalledExactlyOnceWith(
        view.store.dAppRequestStore.dAppRequestData,
      );
      expect(order.mock.invocationCallOrder[0]).toBeGreaterThan(
        vi.mocked(revalidateAuthorizedDAppRequest).mock.invocationCallOrder[0],
      );
      expect(record).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0]?.[0].error).toMatchObject({
        code: -32602,
        message:
          "Refund fields must be zero: the vault will reject this transaction. Approval is disabled.",
      });
      expect(view.getMnemonicPhrases).not.toHaveBeenCalled();
      expect(signing.signTypedData).not.toHaveBeenCalled();
    },
  );

  it.each(["empty-call", "approval-empty"])(
    "signs the same parsed %s object that passed the final gate",
    async (label) => {
      const view = harness(vaultPayload(label));
      const parser = vi.spyOn(signing, "parseTypedDataPayload");
      const assertion = vi.spyOn(policy, "assertVaultRequestSignable");
      const record = await view.approve();
      expect(parser).toHaveBeenCalledTimes(1);
      const checked = assertion.mock.calls[0]?.[0];
      expect(checked).toBe(parser.mock.results[0]?.value);
      expect(signing.signTypedData).toHaveBeenCalledExactlyOnceWith(
        checked,
        canonical.signingVectors[0].hexSeed,
      );
      expect(view.getMnemonicPhrases).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledExactlyOnceWith({ signature: "0xsigned" });
    },
  );

  it("refuses an unparseable typed payload before unlocking", async () => {
    const view = harness(null);
    const record = await view.approve();
    expect(record.mock.calls[0]?.[0].error).toMatchObject({ code: -32602 });
    expect(view.getMnemonicPhrases).not.toHaveBeenCalled();
    expect(signing.signTypedData).not.toHaveBeenCalled();
  });

  it("preserves authorization refusal before the vault gate", async () => {
    const view = harness(vaultPayload());
    const assertion = vi.spyOn(policy, "assertVaultRequestSignable");
    vi.mocked(revalidateAuthorizedDAppRequest).mockResolvedValue({
      canProceed: false,
      proceedError: providerErrors.unauthorized({
        message: "Test authorization refusal",
      }),
    });
    await view.approve();
    expect(assertion).not.toHaveBeenCalled();
    expect(view.getMnemonicPhrases).not.toHaveBeenCalled();
  });
});

it("uses imported ZRC-20 metadata for the signer and active chain without contract reads", async () => {
  const payload = vaultPayload();
  payload.message.data = vaultCalldata("approve").data;
  payload.message.to = vaultTestAddress;
  vi.spyOn(StorageUtil, "getActiveBlockChain").mockResolvedValue({
    chainId: "0x1",
  });
  const tokenReader = vi
    .spyOn(StorageUtil, "getTokenContractsList")
    .mockResolvedValue([
      {
        address: toCanonicalQrlAddress(vaultTestAddress),
        symbol: "VAULT",
        decimals: 6,
        image: "",
      },
    ]);
  const view = harness(payload);
  const getTokenDetails = vi.spyOn(view.store.qrlStore, "getZrc20TokenDetails");
  view.store.qrlStore.qrlConnection.blockchain = {
    ...view.store.qrlStore.qrlConnection.blockchain,
    chainId: "0x1",
  };
  view.replace(requestFor(payload));
  await waitFor(() =>
    expect(screen.getByText("1.2345 VAULT")).toBeInTheDocument(),
  );
  expect(tokenReader).toHaveBeenCalledWith(
    canonical.signingVectors[0].signer,
    "0x1",
  );
  expect(getTokenDetails).not.toHaveBeenCalled();
  view.store.qrlStore.qrlConnection.blockchain = {
    ...view.store.qrlStore.qrlConnection.blockchain,
    chainId: "0x2",
  };
  view.replace(requestFor(payload));
  expect(screen.queryByText("1.2345 VAULT")).not.toBeInTheDocument();
  expect(
    screen.getByText(/1234500: token base units or an NFT token ID/),
  ).toBeInTheDocument();
});

it.each([
  "invalid-operation",
  "expired-validity",
  "zero-validity",
  "nonzero-tx-gas",
  "unlimited-approve",
  "scheduled-update-delay",
])("keeps advisory warnings approvable for %s", (label) => {
  const view = harness(vaultPayload(label));
  expect(view.setCanProceed).toHaveBeenLastCalledWith(true);
});

it("uses the requesting frame origin from senderData and names a differing parent", () => {
  const payload = vaultPayload();
  const view = harness(payload);
  const sender = {
    url: "https://unlisted.example/vault",
    mainFrameOrigin: "https://quantavault.io/embed",
  };
  view.replace({ ...requestFor(payload), requestData: { senderData: sender } });
  expect(
    screen.getByText(/browser-reported requesting frame origin/),
  ).toHaveTextContent("https://quantavault.io");
  expect(view.setCanProceed).toHaveBeenLastCalledWith(true);
});
