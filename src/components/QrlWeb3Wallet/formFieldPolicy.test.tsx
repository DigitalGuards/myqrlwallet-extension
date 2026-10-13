import { mockedStore } from "@/__mocks__/mockedStore";
import { getMnemonicFromHexSeed } from "@/functions/getMnemonicFromHexSeed";
import { StoreProvider } from "@/stores/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Web3BaseWalletAccount } from "@theqrl/web3";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LockPasswordCheck from "./ScreenLoader/Lock/LockPassword/LockPasswordCheck/LockPasswordCheck";
import LockPasswordSetup from "./ScreenLoader/Lock/LockPassword/Onboarding/LockPasswordSetup/LockPasswordSetup";
import SeedBackup from "./ScreenLoader/Shared/SeedBackup/SeedBackup";
import ImportHexSeedForm from "./ScreenLoader/Wallet/Body/ImportAccount/ImportHexSeedForm/ImportHexSeedForm";
import ImportMnemonicForm from "./ScreenLoader/Wallet/Body/ImportAccount/ImportMnemonicForm/ImportMnemonicForm";

const {
  mockGetUnlockAttemptState,
  mockRecordFailedUnlockAttempt,
  mockClearUnlockAttempts,
} = vi.hoisted(() => ({
  mockGetUnlockAttemptState: vi.fn(),
  mockRecordFailedUnlockAttempt: vi.fn(),
  mockClearUnlockAttempts: vi.fn(),
}));

vi.mock("@/utilities/unlockAttemptLimiter", () => ({
  getUnlockAttemptState: mockGetUnlockAttemptState,
  recordFailedUnlockAttempt: mockRecordFailedUnlockAttempt,
  clearUnlockAttempts: mockClearUnlockAttempts,
}));

const ACCOUNT: Web3BaseWalletAccount = {
  address: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
  seed: "0x7819dc0205e6a5c286796886ce16e637b99e1838701cc6988c5886ddc890a7f328771d9197fd17f36faa759d9b8c4c42",
  signTransaction: () =>
    Promise.reject(new Error("Signing is unavailable in this fixture")),
  sign: () => {
    throw new Error("Signing is unavailable in this fixture");
  },
  encrypt: () =>
    Promise.reject(new Error("Encryption is unavailable in this fixture")),
};

const withStore = (children: React.ReactNode) =>
  render(
    <StoreProvider value={mockedStore()}>
      <MemoryRouter>{children}</MemoryRouter>
    </StoreProvider>,
  );

/**
 * Every form control needs an id or a name, or Chrome reports it in the
 * Issues panel and autofill cannot reason about the field at all.
 */
const expectIdentified = (field: HTMLElement) => {
  expect(field.getAttribute("id") ?? field.getAttribute("name")).toBeTruthy();
};

/**
 * Secret material (recovery phrase, hex seed, private key). None of it may
 * ever reach autofill, a password manager, or the spelling dictionary.
 */
const expectNeverAutofilled = (field: HTMLElement) => {
  expect(field).toHaveAttribute("autocomplete", "off");
  expect(field).toHaveAttribute("autocorrect", "off");
  expect(field).toHaveAttribute("autocapitalize", "off");
  expect(field).toHaveAttribute("spellcheck", "false");
};

describe("form field policy", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mockGetUnlockAttemptState.mockReset().mockResolvedValue({
      failedAttempts: 0,
      waitUntil: 0,
    });
    mockRecordFailedUnlockAttempt.mockReset().mockResolvedValue({
      failedAttempts: 1,
      waitUntil: 0,
    });
    mockClearUnlockAttempts.mockReset().mockResolvedValue(undefined);
  });

  describe("wallet unlock password", () => {
    it("is an identified current-password field a password manager can fill", () => {
      withStore(<LockPasswordCheck />);

      const password = screen.getByLabelText("Enter password");
      expect(password).toHaveAttribute("type", "password");
      expect(password).toHaveAttribute("autocomplete", "current-password");
      expect(password).toHaveAttribute("id", "walletUnlockPassword");
      expect(password).toHaveAttribute("name", "password");
    });
  });

  describe("password setup", () => {
    it("marks both fields as new-password so no existing credential is offered", () => {
      withStore(
        <LockPasswordSetup selectStep={() => {}} setNewPassword={() => {}} />,
      );

      const password = screen.getByLabelText("password");
      const confirmation = screen.getByLabelText("reEnteredPassword");

      for (const field of [password, confirmation]) {
        expect(field).toHaveAttribute("type", "password");
        expect(field).toHaveAttribute("autocomplete", "new-password");
        expectIdentified(field);
      }
      expect(password.getAttribute("id")).not.toBe(
        confirmation.getAttribute("id"),
      );
    });
  });

  describe("secret import fields", () => {
    it("keeps the hex seed away from autofill", () => {
      withStore(<ImportHexSeedForm onImported={vi.fn()} />);

      const hexSeed = screen.getByLabelText("hexSeed");
      expectIdentified(hexSeed);
      expectNeverAutofilled(hexSeed);
    });

    it("keeps the recovery phrase away from autofill", () => {
      withStore(<ImportMnemonicForm onImported={vi.fn()} />);

      const mnemonic = screen.getByLabelText("mnemonicPhrases");
      expectIdentified(mnemonic);
      expectNeverAutofilled(mnemonic);
    });
  });

  describe("recovery phrase confirmation", () => {
    it("gives every word input its own name and keeps it out of autofill", async () => {
      render(<SeedBackup account={ACCOUNT} onConfirmed={vi.fn()} />);

      await userEvent.click(
        screen.getByRole("button", { name: "Reveal recovery phrase" }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "I saved my recovery phrase" }),
      );

      const positions = screen
        .getAllByText(/^Word \d+$/)
        .map((label) => Number(label.textContent.replace("Word ", "")));
      expect(positions.length).toBeGreaterThan(0);

      const names = new Set<string>();
      for (const position of positions) {
        const word = screen.getByLabelText(`Word ${position}`);
        expectIdentified(word);
        expectNeverAutofilled(word);
        expect(word).toHaveAttribute("name", `recoveryPhraseWord${position}`);
        const name = word.getAttribute("name");
        if (name === null) throw new Error("Recovery word input has no name");
        names.add(name);
      }
      expect(names.size).toBe(positions.length);
    });

    it("derives its words from the account seed", () => {
      // Guards the fixture: a broken seed would make the loop above vacuous.
      expect(getMnemonicFromHexSeed(ACCOUNT.seed).split(" ")).toHaveLength(32);
    });
  });
  it("reports a failed password callback and keeps the current step", async () => {
    const error = new Error("password setup failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const selectStep = vi.fn();
    withStore(
      <LockPasswordSetup
        selectStep={selectStep}
        setNewPassword={() => {
          throw error;
        }}
      />,
    );

    await userEvent.type(screen.getByLabelText("password"), "testpassword");
    await userEvent.type(
      screen.getByLabelText("reEnteredPassword"),
      "testpassword",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Failed to set up the wallet password:",
        error,
      );
    });
    expect(selectStep).not.toHaveBeenCalled();
    expect(screen.getByLabelText("password")).toBeEnabled();
  });
});
