import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import en from "@/i18n/locales/en.json";
import de from "@/i18n/locales/de.json";
import es from "@/i18n/locales/es.json";
import ru from "@/i18n/locales/ru.json";
import zhCN from "@/i18n/locales/zh-CN.json";
import {
  vaultPayload,
  vaultCalldata,
  vaultReviewTime,
  vaultTestAddress,
} from "@/functions/pqSigning/__tests__/quantaVaultFixtures";
import {
  recognizeVaultRequest,
  VAULT_MAX_UINT256,
} from "@/functions/pqSigning/quantaVault";
import { toCanonicalQrlAddress } from "@/utilities/addressUtil";
import type { TypedDataPayload } from "@/functions/pqSigning";
import DAppVaultReview from "./DAppVaultReview";

function recognized(payload = vaultPayload()) {
  const request = recognizeVaultRequest(payload);
  if (!request) throw new Error("Missing vault fixture");
  return request;
}
function transaction(payload: TypedDataPayload) {
  const request = recognized(payload);
  if (request.kind === "VaultMessage") throw new Error("Missing transaction");
  return request;
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Number(vaultReviewTime) * 1000);
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});

it("shows exact value, checksum addresses, nonce, expiry, txGas and every refund field", () => {
  const payload = vaultPayload();
  payload.message.value = "1000000000000000001";
  const request = transaction(payload);
  render(
    <DAppVaultReview
      request={request}
      authorizedChainId="0x1"
      origin="https://quantavault.io"
    />,
  );
  expect(screen.getByText("1.000000000000000001 Quanta")).toBeInTheDocument();
  for (const address of [
    request.vault,
    request.tx.to,
    request.tx.gasToken,
    request.tx.refundReceiver,
  ]) {
    expect(
      screen.getAllByTitle(toCanonicalQrlAddress(address)).length,
    ).toBeGreaterThan(0);
  }
  for (const label of [
    "Nonce",
    "Valid until",
    "txGas (gas check and failure handling)",
    "baseGas (refund)",
    "gasPrice (refund)",
    "Gas refund token",
    "Refund receiver",
  ]) {
    expect(
      screen.getByText(label).nextElementSibling,
    ).not.toBeEmptyDOMElement();
  }
  expect(
    screen.getByText(/inner call receives all remaining gas/),
  ).toBeInTheDocument();
  expect(screen.queryByText(/txGas is nonzero/)).not.toBeInTheDocument();
});

it.each(["tx", "approval"])(
  "shows effective zero batch targets for %s under Call and DelegateCall",
  (kind) => {
    for (const op of ["call", "delegatecall"]) {
      const request = transaction(vaultPayload(`${kind}-zero-target-${op}`));
      const caller =
        request.kind === "VaultApproval" ? request.outerVault : request.vault;
      render(<DAppVaultReview request={request} />);
      const enclosed = screen.getByText("Enclosed call 1").parentElement;
      if (!enclosed) throw new Error("Missing child call");
      expect(
        within(enclosed).getByTitle(
          toCanonicalQrlAddress(op === "call" ? request.tx.to : caller),
        ),
      ).toBeInTheDocument();
      expect(
        within(enclosed).getByText(/batch entry named the zero address/),
      ).toBeInTheDocument();
      expect(within(enclosed).getByText("changeThreshold")).toBeInTheDocument();
      expect(
        within(enclosed).getByText("Required approvals").nextElementSibling,
      ).toHaveTextContent("2");
      if (op === "delegatecall")
        expect(
          screen.getByText(/full control of the vault/),
        ).toBeInTheDocument();
      if (kind === "approval")
        expect(
          screen.getByText("On behalf of outer vault"),
        ).toBeInTheDocument();
      cleanup();
    }
  },
);

it.each(["1", "0x01", "0X1"])(
  "normalizes the authorized chain %s numerically",
  (authorizedChainId) => {
    render(
      <DAppVaultReview
        request={recognized()}
        authorizedChainId={authorizedChainId}
      />,
    );
    expect(
      screen.queryByText(/differs from the authorized request chain/),
    ).not.toBeInTheDocument();
  },
);
it("compares the signed chain with the authorized request chain independently of the active chain", () => {
  render(
    <DAppVaultReview
      request={recognized()}
      activeChainId="0x1"
      authorizedChainId="0x2"
    />,
  );
  expect(
    screen.getByText(/chain ID \(1\).*authorized request chain \(2\)/),
  ).toHaveAttribute("role", "alert");
});

it("warns on the browser-reported frame origin and names a differing parent without an extra origin row", () => {
  const { rerender } = render(
    <DAppVaultReview
      request={recognized()}
      origin="https://unlisted.example/vault"
      parentOrigin="https://quantavault.io/embedded"
    />,
  );
  expect(
    screen.getByText(/browser-reported requesting frame origin/),
  ).toHaveTextContent("https://quantavault.io");
  expect(
    screen.queryByText("https://quantavault.io", { exact: true }),
  ).not.toBeInTheDocument();
  rerender(
    <DAppVaultReview
      request={recognized()}
      origin="https://quantavault.io/vault"
      parentOrigin="https://unlisted.example/embedded"
    />,
  );
  expect(screen.queryByText(/browser-reported/)).not.toBeInTheDocument();
  rerender(
    <DAppVaultReview
      request={recognized()}
      origin="https://unlisted.example/vault"
      parentOrigin="https://unlisted.example/embedded"
    />,
  );
  expect(screen.getByText(/browser-reported page origin/)).toBeInTheDocument();
  expect(screen.queryByText(/This frame is embedded/)).not.toBeInTheDocument();
});

it.each(["expired-validity", "zero-validity"])(
  "warns for %s using the device clock",
  (label) => {
    render(<DAppVaultReview request={recognized(vaultPayload(label))} />);
    expect(
      screen.getByText(/this approval has already expired/),
    ).toBeInTheDocument();
    expect(screen.getByText(/\(local time\)/)).toBeInTheDocument();
  },
);
it("distinguishes a long approval from maximum validity and warns for nonzero txGas", () => {
  const request = transaction(vaultPayload("nonzero-tx-gas"));
  request.tx.validUntil = vaultReviewTime + 31n * 86400n;
  const { rerender } = render(<DAppVaultReview request={request} />);
  expect(screen.getByText(/valid for more than 30 days/)).toBeInTheDocument();
  expect(screen.getByText(/txGas is nonzero/)).toBeInTheDocument();
  request.tx.validUntil = VAULT_MAX_UINT256;
  rerender(<DAppVaultReview request={request} />);
  expect(screen.getByText(/no practical expiry/)).toBeInTheDocument();
  expect(
    screen.getByText(/Beyond the supported date range/),
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/valid for more than 30 days/),
  ).not.toBeInTheDocument();
});
it("flags a 64-byte VaultMessage as an opaque approval", () => {
  const payload = vaultPayload("empty-message");
  payload.message.message = `0x${"ab".repeat(64)}`;
  render(<DAppVaultReview request={recognized(payload)} />);
  expect(screen.getByText("Approve a vault message")).toBeInTheDocument();
  expect(screen.getByText(/approves an opaque value/)).toBeInTheDocument();
});

it("shows unknown and undecodable calldata raw alongside operation warnings once", () => {
  const request = transaction(vaultPayload("invalid-operation"));
  request.tx.data = "0xdeadbeef";
  const { rerender } = render(<DAppVaultReview request={request} />);
  expect(screen.getByText("0xdeadbeef")).toBeInTheDocument();
  expect(screen.getByText(/Unknown selector/)).toBeInTheDocument();
  request.tx.data = vaultCalldata("approve").data.slice(0, -2);
  rerender(<DAppVaultReview request={request} />);
  expect(screen.getByText(request.tx.data)).toBeInTheDocument();
  expect(screen.getAllByText(/This transaction cannot execute/)).toHaveLength(
    1,
  );
  expect(
    screen.getAllByText(/Calldata could not be decoded completely/),
  ).toHaveLength(1);
  request.tx.data = vaultCalldata("approve").data;
  rerender(<DAppVaultReview request={request} />);
  expect(screen.getByText("approve")).toBeInTheDocument();
  expect(
    screen.queryByText(/Calldata could not be decoded completely/),
  ).not.toBeInTheDocument();
});

it("warns for updateDelay, unlimited approval and an open grant while preserving revoke semantics", () => {
  const { rerender } = render(
    <DAppVaultReview
      request={recognized(vaultPayload("scheduled-update-delay"))}
    />,
  );
  expect(screen.getByText("updateDelay")).toBeInTheDocument();
  expect(screen.getByText("0d 0h 0m 0s (0 seconds)")).toBeInTheDocument();
  expect(
    screen.getByText(/changes the vault or target contract/),
  ).toBeInTheDocument();
  rerender(
    <DAppVaultReview request={recognized(vaultPayload("unlimited-approve"))} />,
  );
  expect(screen.getByText(/Unlimited allowance:/)).toBeInTheDocument();
  expect(
    screen.getByText(/token base units or an NFT token ID/),
  ).toBeInTheDocument();
  rerender(
    <DAppVaultReview request={recognized(vaultPayload("revoke-zero-role"))} />,
  );
  expect(screen.getByText("revokeRole")).toBeInTheDocument();
  expect(screen.queryByText(/opens it to everyone/)).not.toBeInTheDocument();
});

it.each(["approve", "transferFrom", "transfer"])(
  "uses local token metadata only for the matching %s target and active chain",
  (method) => {
    const request = transaction(vaultPayload());
    request.tx.data = vaultCalldata(method).data;
    request.tx.to = vaultTestAddress;
    const knownTokens = [
      {
        address: toCanonicalQrlAddress(vaultTestAddress),
        symbol: "LOCAL",
        decimals: 6,
        image: "",
      },
    ];
    const { rerender } = render(
      <DAppVaultReview
        request={request}
        activeChainId="0x1"
        knownTokens={knownTokens}
      />,
    );
    expect(screen.getByText("1.2345 LOCAL")).toBeInTheDocument();
    rerender(
      <DAppVaultReview
        request={request}
        activeChainId="0x2"
        knownTokens={knownTokens}
      />,
    );
    expect(screen.queryByText("1.2345 LOCAL")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        method === "transfer"
          ? /1234500 base units/
          : /1234500: token base units or an NFT token ID/,
      ),
    ).toBeInTheDocument();
    request.tx.to = `Q${"45".repeat(64)}`;
    rerender(
      <DAppVaultReview
        request={request}
        activeChainId="0x1"
        knownTokens={knownTokens}
      />,
    );
    expect(screen.queryByText("1.2345 LOCAL")).not.toBeInTheDocument();
    expect(
      screen.getAllByTitle(toCanonicalQrlAddress(request.tx.to)),
    ).toHaveLength(2);
  },
);

it.each([null, -1, 256, 1.5, NaN])(
  "keeps base units when imported decimals are invalid (%s)",
  (decimals) => {
    const request = transaction(vaultPayload());
    request.tx.to = vaultTestAddress;
    request.tx.data = vaultCalldata("approve").data;
    render(
      <DAppVaultReview
        request={request}
        activeChainId="0x1"
        knownTokens={[
          { address: vaultTestAddress, symbol: "LOCAL", decimals, image: "" },
        ]}
      />,
    );
    expect(screen.getByText(/token details unavailable/)).toBeInTheDocument();
  },
);

describe.each(Object.entries({ en, de, es, ru, "zh-CN": zhCN }))(
  "%s vault translations",
  (language, catalog) => {
    it("renders translated approval, warning and field labels", async () => {
      i18n.addResourceBundle(language, "translation", catalog, true, true);
      await i18n.changeLanguage(language);
      const request = transaction(vaultPayload("unlimited-approve"));
      request.tx.txGas = 1n;
      request.tx.validUntil = 0n;
      render(<DAppVaultReview request={request} />);
      for (const key of [
        "transaction",
        "unlimitedAllowance",
        "expiredWarning",
        "txGasWarning",
        "originWarning",
        "expiry",
        "refundReceiver",
      ]) {
        expect(
          screen.getByText(i18n.t(`dapp.vault.${key}`)),
        ).toBeInTheDocument();
      }
      expect(screen.getByTestId("vault-review")).not.toHaveTextContent(
        "dapp.vault.",
      );
    });
  },
);
