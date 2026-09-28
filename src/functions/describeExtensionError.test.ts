import { describe, expect, it } from "vitest";
import {
  describeExtensionError,
  isWalletLockedError,
} from "./describeExtensionError";

const t = ((key: string) => key) as any;

describe("describeExtensionError", () => {
  it("maps the wallet-locked guard message to a translated key (L4)", () => {
    const error = new Error("MyQRLWallet is locked");

    expect(describeExtensionError(error, t, "fallback")).toBe(
      "account.walletLockedError",
    );
  });

  it("maps a transient connection-drop error to a translated key (R1)", () => {
    const error = new Error(
      "Could not establish connection. Receiving end does not exist.",
    );

    expect(describeExtensionError(error, t, "fallback")).toBe(
      "account.transientConnectionError",
    );
  });

  it("surfaces any other Error's own message as-is", () => {
    const error = new Error("Insufficient balance");

    expect(describeExtensionError(error, t, "fallback")).toBe(
      "Insufficient balance",
    );
  });

  it("falls back to the caller-supplied default for a non-Error value", () => {
    expect(describeExtensionError("not an error", t, "fallback")).toBe(
      "fallback",
    );
  });
});

describe("isWalletLockedError", () => {
  it("is true only for the exact locked-wallet guard message", () => {
    expect(isWalletLockedError(new Error("MyQRLWallet is locked"))).toBe(true);
  });

  it("is false for an unrelated Error", () => {
    expect(isWalletLockedError(new Error("something else"))).toBe(false);
  });

  it("is false for a non-Error value", () => {
    expect(isWalletLockedError("MyQRLWallet is locked")).toBe(false);
  });
});
