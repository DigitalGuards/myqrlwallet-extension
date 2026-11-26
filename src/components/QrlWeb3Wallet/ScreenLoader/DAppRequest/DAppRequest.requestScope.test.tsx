import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import DAppRequest from "./DAppRequest";

const contentMounts = vi.hoisted(() => ({ count: 0 }));

vi.mock("./DAppRequestContentSelection/DAppRequestContentSelection", () => ({
  default: () => {
    useEffect(() => {
      contentMounts.count += 1;
    }, []);
    return <div>Request content</div>;
  },
}));

const request = (requestId: string, url: string, isDomainPhishing: boolean) =>
  mockedStore({
    dAppRequestStore: {
      dAppRequestData: {
        requestId,
        method: "qrl_requestAccounts",
        requestData: { senderData: { tabId: 1, url } },
        phishingResult: {
          isDomainPhishing,
          matchedDomain: isDomainPhishing ? new URL(url).hostname : undefined,
        },
      },
    },
  });

const tree = (store: ReturnType<typeof mockedStore>) => (
  <StoreProvider value={store}>
    <DAppRequest />
  </StoreProvider>
);

// The approval screen can stay mounted while one request replaces another
// (the side panel and the expanded tab both do), so nothing the user did
// for the first request may carry over to the second.
describe("DAppRequest scope per request", () => {
  afterEach(() => {
    cleanup();
    contentMounts.count = 0;
  });

  it("shows the phishing warning again for a different request", () => {
    const { rerender } = render(
      tree(request("request-a", "https://first-bad.example/", true)),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "I understand the risk, proceed anyway",
      }),
    );
    expect(screen.queryByText("Phishing Warning")).not.toBeInTheDocument();

    rerender(tree(request("request-b", "https://second-bad.example/", true)));

    expect(screen.getByText("Phishing Warning")).toBeInTheDocument();
  });

  it("keeps the acknowledgement for the request it was given for", () => {
    const store = request("request-a", "https://first-bad.example/", true);
    const { rerender } = render(tree(store));
    fireEvent.click(
      screen.getByRole("button", {
        name: "I understand the risk, proceed anyway",
      }),
    );

    rerender(tree(store));

    expect(screen.queryByText("Phishing Warning")).not.toBeInTheDocument();
  });

  it("starts the request content fresh for each request", () => {
    const { rerender } = render(
      tree(request("request-a", "https://a.example/", false)),
    );
    expect(contentMounts.count).toBe(1);

    rerender(tree(request("request-b", "https://b.example/", false)));

    expect(contentMounts.count).toBe(2);
  });
});
