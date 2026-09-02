import { getMnemonicFromHexSeed } from "@/functions/getMnemonicFromHexSeed";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Web3BaseWalletAccount } from "@theqrl/web3";
import { afterEach, describe, expect, it, vi } from "vitest";
import SeedBackup, { pickConfirmPositions } from "./SeedBackup";

const ACCOUNT = {
  address: "Q20fB08fF1f1376A14C055E9F56df80563E16722b",
  seed: "0x7819dc0205e6a5c286796886ce16e637b99e1838701cc6988c5886ddc890a7f328771d9197fd17f36faa759d9b8c4c42",
} as unknown as Web3BaseWalletAccount;
const WORDS = getMnemonicFromHexSeed(ACCOUNT.seed).split(" ");

const renderComponent = (
  props: Partial<React.ComponentProps<typeof SeedBackup>> = {},
) => {
  const onConfirmed = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <SeedBackup account={ACCOUNT} onConfirmed={onConfirmed} {...props} />,
  );
  return { ...utils, onConfirmed };
};

const reveal = async () =>
  userEvent.click(
    screen.getByRole("button", { name: "Reveal recovery phrase" }),
  );

const goToConfirm = async () => {
  await reveal();
  await userEvent.click(
    screen.getByRole("button", { name: "I saved my recovery phrase" }),
  );
};

/** Reads the requested positions off the confirm step's labels. */
const requestedPositions = () =>
  screen
    .getAllByText(/^Word \d+$/)
    .map((label) => Number(label.textContent!.replace("Word ", "")));

const fillWords = async (getWord: (position: number) => string) => {
  for (const position of requestedPositions()) {
    await userEvent.type(
      screen.getByLabelText(`Word ${position}`),
      getWord(position),
    );
  }
};

describe("SeedBackup", () => {
  afterEach(cleanup);

  it("has 32 words to back up", () => {
    expect(WORDS).toHaveLength(32);
  });

  it("keeps the words out of the DOM until revealed", async () => {
    renderComponent();

    expect(screen.queryByText(WORDS[0])).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "I saved my recovery phrase" }),
    ).toBeDisabled();

    await reveal();

    const grid = screen.getByRole("list", { name: "Recovery phrase" });
    expect(within(grid).getAllByRole("listitem")).toHaveLength(32);
    expect(within(grid).getByText(WORDS[0])).toBeInTheDocument();
    expect(within(grid).getByText(WORDS[31])).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "I saved my recovery phrase" }),
    ).toBeEnabled();
  });

  it("shows the hex seed only on request", async () => {
    renderComponent();
    await reveal();

    expect(screen.queryByText("Hex seed")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Show hex seed" }),
    );
    expect(screen.getByText("Hex seed")).toBeInTheDocument();
    expect(screen.getByText("7819dc02")).toBeInTheDocument();
  });

  it("downloads the backup file", async () => {
    renderComponent();
    await reveal();
    const createObjectURL = vi.fn();
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      writable: true,
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Download backup file" }),
    );

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("asks for three distinct positions and rejects wrong words", async () => {
    const { onConfirmed } = renderComponent();
    await goToConfirm();

    const positions = requestedPositions();
    expect(positions).toHaveLength(3);
    expect(new Set(positions).size).toBe(3);
    expect(
      screen.getByRole("button", { name: "Confirm backup" }),
    ).toBeDisabled();

    await fillWords(() => "wrong");
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm backup" }),
    );

    expect(
      screen.getByText(
        "One or more words do not match your recovery phrase. Check your backup and try again.",
      ),
    ).toBeInTheDocument();
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it("confirms when the words match, ignoring case and whitespace", async () => {
    const { onConfirmed } = renderComponent();
    await goToConfirm();

    await fillWords((position) => ` ${WORDS[position - 1].toUpperCase()} `);
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm backup" }),
    );

    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it("returns to the phrase from the confirm step and shows a persist error", async () => {
    renderComponent({ error: "The account could not be saved." });
    await goToConfirm();

    expect(
      screen.getByText("The account could not be saved."),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Show the phrase again" }),
    );
    expect(
      screen.getByRole("heading", { name: "Back up your recovery phrase" }),
    ).toBeInTheDocument();
  });

  it("warns before skipping the check and persists only on explicit skip", async () => {
    const { onConfirmed } = renderComponent();
    await goToConfirm();

    await userEvent.click(
      screen.getByRole("button", { name: "Skip confirmation" }),
    );
    expect(
      screen.getByRole("alertdialog", { name: "Skip the backup check?" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onConfirmed).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole("button", { name: "Skip confirmation" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Skip anyway" }));
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it("offers a back action only when the caller provides one", async () => {
    const onBack = vi.fn();
    renderComponent({ onBack });

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);

    cleanup();
    renderComponent();
    expect(
      screen.queryByRole("button", { name: "Back" }),
    ).not.toBeInTheDocument();
  });
});

describe("pickConfirmPositions", () => {
  it("returns distinct ascending positions inside the phrase", () => {
    for (let i = 0; i < 50; i += 1) {
      const positions = pickConfirmPositions(32);
      expect(positions).toHaveLength(3);
      expect(new Set(positions).size).toBe(3);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      positions.forEach((p) => {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(32);
      });
    }
  });
});
