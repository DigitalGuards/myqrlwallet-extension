import typed from "../__fixtures__/quantaVault/typed-data-v2.json";
import approvals from "../__fixtures__/quantaVault/vault-approvals.json";
import calls from "../__fixtures__/quantaVault/calldata.json";
import review from "../__fixtures__/quantaVault/review-cases.json";
import { parsePayload } from "../typedData";
import { isRecord } from "@/utilities/storageGuards";

export const vaultTestAddress = `Q${"ab".repeat(64)}`;
export const vaultSchemeVectors = [
  ...typed.schemeVectors,
  ...approvals.schemeVectors,
];
export const vaultReviewVectors = review.cases;
export const vaultReviewTime = BigInt(review.reviewTime);

export function vaultPayload(label = "empty-call") {
  const reviewCase = vaultReviewVectors.find(
    (vector) => vector.label === label,
  );
  const fixture = vaultSchemeVectors.find(
    (vector) => vector.label === (reviewCase?.baseLabel ?? label),
  );
  if (!fixture) throw new Error(`Missing vault fixture: ${label}`);
  // JSON fixtures contain only JSON values; isolate nested mutation tests.
  const cloned: unknown = JSON.parse(JSON.stringify(fixture.payload));
  const payload = parsePayload(cloned);
  if (reviewCase) {
    const tx =
      payload.primaryType === "VaultApproval"
        ? payload.message["tx"]
        : payload.message;
    if (!isRecord(tx)) throw new Error("Missing vault transaction");
    Object.assign(tx, reviewCase.tx);
  }
  return payload;
}

export function vaultCalldata(method: string) {
  const fixture = calls.find((vector) => vector.method === method);
  if (!fixture) throw new Error(`Missing call fixture: ${method}`);
  return fixture;
}
