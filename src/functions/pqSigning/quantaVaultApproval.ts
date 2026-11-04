import i18n from "@/i18n";
import { rpcErrors } from "@theqrl/qrl-wallet-provider";
import { vaultApprovalBlocked } from "./quantaVault";
import type { TypedDataPayload } from "./typedData";

/** Both approval gates check the parsed payload before the seed is unlocked. */
export function assertVaultRequestSignable(parsed: TypedDataPayload): void {
  if (vaultApprovalBlocked(parsed)) {
    throw rpcErrors.invalidParams({
      message: i18n.t("dapp.vault.refundError"),
    });
  }
}
