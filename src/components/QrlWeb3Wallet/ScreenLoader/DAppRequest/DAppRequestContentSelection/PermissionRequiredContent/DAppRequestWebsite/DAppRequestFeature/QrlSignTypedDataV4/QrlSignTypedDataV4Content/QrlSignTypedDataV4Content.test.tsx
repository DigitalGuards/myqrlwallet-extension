import { mockedStore } from "@/__mocks__/mockedStore";
import type { ResponseRecorder } from "@/stores/dAppRequestStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/UI/Tooltip";
import QrlSignTypedDataV4Content from "./QrlSignTypedDataV4Content";

describe("QrlSignTypedDataV4Content", () => {
  afterEach(cleanup);

  const fromAddress = "Q20D20b8026B8F02540246f58120ddAAf35AECD9B";
  const msgParams = {
    types: {
      EIP712Domain: [
        {
          name: "name",
          type: "string",
        },
        {
          name: "version",
          type: "string",
        },
        {
          name: "chainId",
          type: "uint256",
        },
        {
          name: "verifyingContract",
          type: "address",
        },
      ],
      Person: [
        {
          name: "name",
          type: "string",
        },
        {
          name: "wallet",
          type: "address",
        },
      ],
      Mail: [
        {
          name: "from",
          type: "Person",
        },
        {
          name: "to",
          type: "Person",
        },
        {
          name: "contents",
          type: "string",
        },
      ],
    },
    primaryType: "Mail",
    domain: {
      name: "Ether Mail",
      version: "1",
      chainId: 1,
      verifyingContract: "QCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
    },
    message: {
      from: {
        name: "Cow",
        wallet: "QCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826",
      },
      to: {
        name: "Bob",
        wallet: "QbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
      },
      contents: "Hello, Bob!",
    },
  };

  const renderComponent = (mockedStoreValues = mockedStore()) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter>
          <TooltipProvider>
            <QrlSignTypedDataV4Content />
          </TooltipProvider>
        </MemoryRouter>
      </StoreProvider>,
    );

  it("still registers its signing callback while the node is unreachable", async () => {
    // Signing is local, and Approve was enabled whatever the connection
    // was doing. Registering the callback only while connected left the
    // store's no-op default to answer the dApp with an empty success.
    let capturedPermissionCallback:
      | ((hasApproved: boolean, record: ResponseRecorder) => Promise<void>)
      | null = null;
    const recorded: Record<string, unknown>[] = [];

    renderComponent(
      mockedStore({
        qrlStore: {
          qrlConnection: { isConnected: false, isLoading: false },
          qrlInstance: {
            accounts: { seedToAccount: () => ({ address: fromAddress }) },
          } as never,
        },
        dAppRequestStore: {
          dAppRequestData: { params: [fromAddress, msgParams] },
          setOnPermissionCallBack: (
            callback: (
              hasApproved: boolean,
              record: ResponseRecorder,
            ) => Promise<void>,
          ) => {
            capturedPermissionCallback = callback;
          },
        },
      }),
    );

    expect(capturedPermissionCallback).not.toBeNull();
    await act(async () => {
      await capturedPermissionCallback!(true, (data) => {
        recorded.push(data);
      });
    });

    // The approval answered with something. The fixture seed cannot
    // produce a signature here, so that answer is an error; what matters
    // is that an answer exists at all.
    expect(recorded).toHaveLength(1);
    expect(Object.keys(recorded[0] ?? {})).not.toHaveLength(0);
  });

  it("should render the qrl sign typed data v4 content component", () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [fromAddress, msgParams],
          },
        },
      }),
    );

    // Header / from-account
    expect(screen.getByText("From Address")).toBeInTheDocument();
    expect(
      screen.getByText("Q 20D20 b8026 B8F02 54024 6f581 20ddA Af35A ECD9B"),
    ).toBeInTheDocument();

    // Domain accordion: Name, Version, Chain ID, Verifying Contract are
    // each labelled and rendered (F-6).
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Ether Mail")).toBeInTheDocument();
    expect(screen.getByText("Version")).toBeInTheDocument();
    expect(screen.getByText("Chain ID")).toBeInTheDocument();
    expect(screen.getByText("Verifying Contract")).toBeInTheDocument();
    expect(
      screen.getByText("Q CcCCc cccCC CCcCC CCCCc CcCcc CcCCC cCccc ccccC"),
    ).toBeInTheDocument();

    // Message accordion: structured-data banner + primary type
    expect(screen.getByText(/Structured-data signature/i)).toBeInTheDocument();
    expect(screen.getByText("Primary Type")).toBeInTheDocument();
    expect(screen.getByText("Mail")).toBeInTheDocument();

    // Recursive renderer surfaces every message field — including nested
    // structs (from / to) — using the dApp-supplied keys verbatim. This is
    // the F-6 fix: previously only the hardcoded "Mail"-schema fields were
    // shown, leaving Permit / Permit2 / Seaport schemas blank.
    expect(screen.getByText("contents")).toBeInTheDocument();
    expect(screen.getByText("Hello, Bob!")).toBeInTheDocument();
    expect(screen.getByText("from")).toBeInTheDocument();
    expect(screen.getByText("to")).toBeInTheDocument();
    expect(screen.getByText("Cow")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(
      screen.getByText("QCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("QbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"),
    ).toBeInTheDocument();

    const copyButton = screen.getByRole("button", {
      name: "Copy message data",
    });
    expect(copyButton).toBeInTheDocument();
    expect(copyButton).toBeEnabled();
  });

  it("should shrink the expandable section on clicking", async () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [fromAddress, msgParams],
          },
        },
      }),
    );

    const accordionForDomain = screen.getByRole("button", { name: "Domain" });
    expect(accordionForDomain).toBeInTheDocument();
    expect(accordionForDomain).toBeEnabled();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Ether Mail")).toBeInTheDocument();
    expect(screen.getByText("Verifying Contract")).toBeInTheDocument();

    await userEvent.click(accordionForDomain);
    expect(screen.queryByText("Name")).not.toBeInTheDocument();
    expect(screen.queryByText("Ether Mail")).not.toBeInTheDocument();
    expect(screen.queryByText("Verifying Contract")).not.toBeInTheDocument();

    const accordionForMessage = screen.getByRole("button", { name: "Message" });
    expect(accordionForMessage).toBeInTheDocument();
    expect(accordionForMessage).toBeEnabled();
    expect(screen.getByText("Primary Type")).toBeInTheDocument();
    expect(screen.getByText("Mail")).toBeInTheDocument();
    expect(screen.getByText("contents")).toBeInTheDocument();
    expect(screen.getByText("Hello, Bob!")).toBeInTheDocument();
    expect(screen.getByText("from")).toBeInTheDocument();
    expect(screen.getByText("to")).toBeInTheDocument();
    expect(screen.getByText("Cow")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    await userEvent.click(accordionForMessage);
    expect(screen.queryByText("Primary Type")).not.toBeInTheDocument();
    expect(screen.queryByText("contents")).not.toBeInTheDocument();
    expect(screen.queryByText("Hello, Bob!")).not.toBeInTheDocument();
    expect(screen.queryByText("from")).not.toBeInTheDocument();
    expect(screen.queryByText("to")).not.toBeInTheDocument();
    expect(screen.queryByText("Cow")).not.toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  });

  it("should copy the message data to clipboard", async () => {
    renderComponent(
      mockedStore({
        dAppRequestStore: {
          dAppRequestData: {
            params: [fromAddress, msgParams],
          },
        },
      }),
    );
    const clipboardMock = vi.fn().mockResolvedValue(void 0 as never);
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: clipboardMock,
      },
      writable: true,
    });
    const copyButton = screen.getByRole("button", {
      name: "Copy message data",
    });
    await userEvent.click(copyButton);
    expect(clipboardMock).toHaveBeenCalledTimes(1);
    expect(clipboardMock).toHaveBeenCalledWith(
      '{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],"Person":[{"name":"name","type":"string"},{"name":"wallet","type":"address"}],"Mail":[{"name":"from","type":"Person"},{"name":"to","type":"Person"},{"name":"contents","type":"string"}]},"primaryType":"Mail","domain":{"name":"Ether Mail","version":"1","chainId":1,"verifyingContract":"QCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC"},"message":{"from":{"name":"Cow","wallet":"QCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826"},"to":{"name":"Bob","wallet":"QbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB"},"contents":"Hello, Bob!"}}',
    );
  });
});
