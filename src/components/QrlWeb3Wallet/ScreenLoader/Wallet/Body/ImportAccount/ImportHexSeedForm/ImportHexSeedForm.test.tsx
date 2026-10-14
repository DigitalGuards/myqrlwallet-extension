import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImportHexSeedForm from "./ImportHexSeedForm";
import type { Web3BaseWalletAccount } from "@theqrl/web3";

// The QRL extended seed is exactly 51 bytes, so 0x plus 102 hex characters.
const VALID_HEX_SEED = `0x${"ab".repeat(51)}`;
const SHORT_HEX_SEED = `0x${"ab".repeat(32)}`;

describe("ImportHexSeedForm", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const renderComponent = (
    onImported = vi
      .fn<(account: Web3BaseWalletAccount) => Promise<void>>()
      .mockResolvedValue(undefined),
    mockedStoreValues = mockedStore({
      qrlStore: {
        qrlInstance: {
          accounts: {
            seedToAccount: (_seed: string | Uint8Array) => ({
              address: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
              seed: typeof _seed === "string" ? _seed : "",
              sign: (_data: string | Record<string, unknown>) => ({
                messageHash: "",
                signature: "",
              }),
              signTransaction: () =>
                Promise.resolve({
                  messageHash: "",
                  rawTransaction: "",
                  signature: "",
                  transactionHash: "",
                }),
              encrypt: () => Promise.reject(new Error("Not implemented")),
            }),
          },
        },
      },
    }),
  ) => {
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <ImportHexSeedForm onImported={onImported} />
        </MemoryRouter>
      </StoreProvider>,
    );
    return onImported;
  };

  it("renders the hex seed field and disabled import button", async () => {
    renderComponent();

    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: "hexSeed" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Import account" }),
      ).toBeDisabled();
    });
  });

  it("rejects an invalid hex seed format", async () => {
    const onImported = renderComponent();

    await userEvent.type(
      screen.getByRole("textbox", { name: "hexSeed" }),
      "not-a-hex-seed",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Import account" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Invalid hex seed format. It must start with 0x followed by hexadecimal characters",
        ),
      ).toBeInTheDocument();
    });
    expect(onImported).not.toHaveBeenCalled();
  });

  it("rejects a well-formed hex seed of the wrong length", async () => {
    const onImported = renderComponent();

    await userEvent.type(
      screen.getByRole("textbox", { name: "hexSeed" }),
      SHORT_HEX_SEED,
    );

    // wallet.js accepts the 51-byte extended seed and nothing else, so
    // the form checks the length itself. seedToAccount used to throw a raw
    // exception into the field.
    expect(
      await screen.findByText(
        "Invalid hex seed length. It must be 0x followed by exactly 102 hexadecimal characters",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import account" }),
    ).toBeDisabled();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("imports an account from a valid hex seed", async () => {
    const onImported = renderComponent();

    await userEvent.type(
      screen.getByRole("textbox", { name: "hexSeed" }),
      VALID_HEX_SEED,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Import account" }),
    );

    await waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(1);
    });
    expect(onImported.mock.calls[0][0]).toMatchObject({
      address: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
      seed: VALID_HEX_SEED,
    });
  });

  it("reports an account derivation error without importing", async () => {
    const error = new Error("seed derivation failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const onImported = renderComponent(
      undefined,
      mockedStore({
        qrlStore: {
          qrlInstance: {
            accounts: {
              seedToAccount: () => {
                throw error;
              },
            },
          },
        },
      }),
    );

    await userEvent.type(
      screen.getByRole("textbox", { name: "hexSeed" }),
      VALID_HEX_SEED,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Import account" }),
    );

    expect(
      await screen.findByText(
        "Account could not be imported from the hex seed",
      ),
    ).toBeInTheDocument();
    expect(report).toHaveBeenCalledWith(
      "[ImportHexSeedForm] Hex seed import failed:",
      error,
    );
    expect(onImported).not.toHaveBeenCalled();
  });

  it("reports a rejected import and keeps the entered seed available for retry", async () => {
    const error = new Error("persistence failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const onImported = vi
      .fn<(account: Web3BaseWalletAccount) => Promise<void>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined);
    renderComponent(onImported);

    await userEvent.type(
      screen.getByRole("textbox", { name: "hexSeed" }),
      VALID_HEX_SEED,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Import account" }),
    );

    expect(
      await screen.findByText(
        "Account could not be imported from the hex seed",
      ),
    ).toBeInTheDocument();
    expect(report).toHaveBeenCalledWith(
      "[ImportHexSeedForm] Hex seed import failed:",
      error,
    );
    expect(screen.getByRole("textbox", { name: "hexSeed" })).toHaveValue(
      VALID_HEX_SEED,
    );
    expect(onImported).toHaveBeenCalledTimes(1);
    await userEvent.type(
      screen.getByRole("textbox", { name: "hexSeed" }),
      "{backspace}b",
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Import account" }),
      ).toBeEnabled();
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Import account" }),
    );
    expect(onImported).toHaveBeenCalledTimes(2);
  });
});
