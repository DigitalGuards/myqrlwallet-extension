import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImportHexSeedForm from "./ImportHexSeedForm";

const VALID_HEX_SEED =
  "0x0105000cf3d735daf68908cc31e7c9901234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

describe("ImportHexSeedForm", () => {
  afterEach(cleanup);

  const renderComponent = (
    onImported = vi.fn().mockResolvedValue(undefined),
    mockedStoreValues = mockedStore({
      qrlStore: {
        qrlInstance: {
          accounts: {
            seedToAccount: (_seed: string | Uint8Array) => ({
              address: "Q2090E9F38771876FB6Fc51a6b464121d3cC093A1",
              seed: _seed,
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
          "Invalid hex seed format. Must start with '0x' followed by hex characters",
        ),
      ).toBeInTheDocument();
    });
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
});
