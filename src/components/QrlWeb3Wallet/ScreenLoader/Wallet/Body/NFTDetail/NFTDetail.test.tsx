import { mockedStore } from "@/__mocks__/mockedStore";
import { StoreProvider } from "@/stores/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Router,
  type NavigateFunction,
  type NavigateOptions,
  type To,
} from "react-router-dom";
import { ROUTES } from "@/router/router";
import type { NFTMetadata, NFTStandard } from "@/types/nft";
import type { StoreType } from "@/stores/store";
import { isRecord } from "@/utilities/storageGuards";
import { toChecksumAddress } from "@theqrl/wallet.js";
import NFTGalleryItem from "../NFTGallery/NFTGalleryItem";
import NFTTransfer from "../NFTTransfer/NFTTransfer";
import NFTDetail from "./NFTDetail";

const { navigate } = vi.hoisted(() => ({
  navigate:
    vi.fn<
      (
        to: To | number,
        options?: NavigateOptions,
      ) => ReturnType<NavigateFunction>
    >(),
}));
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  )),
  useNavigate: () => navigate,
}));

const defaultState = {
  contractAddress: "Q20B714091cF2a62DADda2847803e3f1B9D2D3779",
  tokenId: "42",
  collectionName: "TestCollection",
  metadata: {
    name: "Cool NFT #42",
    description: "A very cool NFT",
    image: "ipfs://QmImage",
    attributes: [
      { trait_type: "Color", value: "Blue" },
      { trait_type: "Rarity", value: "Legendary" },
    ],
  },
  imageUrl: "https://ipfs.io/ipfs/QmImage",
};

const attributeCases: {
  label: string;
  attributes:
    | {
        trait_type?: string | null;
        value: string | number;
        display_type?: string;
        max_value?: number;
      }[]
    | null
    | undefined;
}[] = [
  { label: "omitted attributes", attributes: undefined },
  { label: "null attributes", attributes: null },
  { label: "empty attributes", attributes: [] },
  {
    label: "named strings",
    attributes: defaultState.metadata.attributes,
  },
  {
    label: "generic strings",
    attributes: [{ value: "Happy" }, { value: "Calm" }],
  },
  {
    label: "explicitly undefined labels",
    attributes: [{ trait_type: undefined, value: "Happy" }],
  },
  {
    label: "null labels",
    attributes: [{ trait_type: null, value: "Happy" }],
  },
  {
    label: "mixed nullable labels",
    attributes: [
      { trait_type: "Color", value: "Blue" },
      { trait_type: null, value: 0 },
      { value: "Happy" },
      { trait_type: null, value: -2.5 },
      { trait_type: "Rarity", value: "Legendary" },
    ],
  },
  {
    label: "empty labels",
    attributes: [{ trait_type: "", value: "Happy" }],
  },
  {
    label: "named numbers",
    attributes: [
      { trait_type: "Level", value: 0 },
      { trait_type: "Score", value: -2.5 },
    ],
  },
  {
    label: "generic numbers",
    attributes: [{ value: 0 }, { value: -2.5 }],
  },
  {
    label: "empty values",
    attributes: [{ trait_type: "Category", value: "" }, { value: "" }],
  },
  {
    label: "mixed attributes with display hints",
    attributes: [
      { trait_type: "Level", value: 0, display_type: "number", max_value: 100 },
      { value: "Happy" },
      { trait_type: "Score", value: -2.5, display_type: "boost_number" },
      { value: "Calm" },
    ],
  },
];

// Optional metadata fields can be null in JSON and absent in route state.
// Every combination retains the other fields through transfer history.
const nullableMetadataCases = [false, true].flatMap((nullName) =>
  [false, true].flatMap((nullDescription) =>
    [false, true].map((nullImage) => ({
      label: `name ${nullName ? "null" : "present"}, description ${nullDescription ? "null" : "present"}, image ${nullImage ? "null" : "present"}`,
      metadata: {
        name: nullName ? null : "Review NFT",
        description: nullDescription ? null : "Preserve this description",
        image: nullImage ? null : "https://example.test/42.png",
        attributes: defaultState.metadata.attributes,
      },
    })),
  ),
);

const optionalMetadataCases: {
  label: string;
  metadata: NFTMetadata | null | undefined;
}[] = [
  ...nullableMetadataCases.map(
    ({ label, metadata: { name, description, image } }) => ({
      label,
      metadata: { name, description, image },
    }),
  ),
  { label: "absent metadata", metadata: undefined },
  { label: "null metadata", metadata: null },
  { label: "empty metadata", metadata: {} },
  { label: "name only", metadata: { name: "Named NFT" } },
  {
    label: "description only",
    metadata: { description: "Only a description" },
  },
  { label: "image only", metadata: { image: defaultState.metadata.image } },
  {
    label: "name and description",
    metadata: {
      name: defaultState.metadata.name,
      description: defaultState.metadata.description,
    },
  },
  {
    label: "name and image",
    metadata: {
      name: defaultState.metadata.name,
      image: defaultState.metadata.image,
    },
  },
  {
    label: "description and image",
    metadata: {
      description: defaultState.metadata.description,
      image: defaultState.metadata.image,
    },
  },
  {
    label: "all core fields",
    metadata: {
      name: defaultState.metadata.name,
      description: defaultState.metadata.description,
      image: defaultState.metadata.image,
    },
  },
  { label: "empty attributes", metadata: { attributes: [] } },
  {
    label: "explicitly undefined fields",
    metadata: {
      name: undefined,
      description: undefined,
      image: undefined,
      attributes: undefined,
    },
  },
  {
    label: "empty strings",
    metadata: { name: "", description: "", image: "" },
  },
];

const absentAttributeCases = [
  { label: "omitted attributes", fields: {} },
  { label: "undefined attributes", fields: { attributes: undefined } },
  { label: "null attributes", fields: { attributes: null } },
  { label: "empty attributes", fields: { attributes: [] } },
];

// The detail renderer has always displayed attribute values with String().
// JSON numbers can overflow, and optional values can be absent in route state.
const jsonAttributeCases = [
  { label: "null", json: "null", text: "null" },
  { label: "false", json: "false", text: "false" },
  { label: "true", json: "true", text: "true" },
  { label: "zero", json: "0", text: "0" },
  { label: "negative zero", json: "-0", text: "0" },
  { label: "fraction", json: "-2.5", text: "-2.5" },
  { label: "positive overflow", json: "1e400", text: "Infinity" },
  { label: "negative overflow", json: "-1e400", text: "-Infinity" },
  { label: "empty string", json: '""', text: "" },
  { label: "string", json: '"Evolved"', text: "Evolved" },
  { label: "empty array", json: "[]", text: "" },
  {
    label: "mixed array",
    json: '[null,false,0,{"level":1},["Blue","Gold"]]',
    text: ",false,0,[object Object],Blue,Gold",
  },
  { label: "empty object", json: "{}", text: "[object Object]" },
  {
    label: "nested object",
    json: '{"level":1,"progress":[true,null]}',
    text: "[object Object]",
  },
  { label: "omitted value", json: undefined, text: "undefined" },
];

// A string-only guard loses JSON children accepted by the original renderer.
// These fixtures check every displayed metadata field and the raw transfer name.
const metadataTextCases = [
  { label: "omitted", json: undefined, text: "", coerced: "undefined" },
  { label: "null", json: "null", text: "", coerced: "null" },
  { label: "false", json: "false", text: "", coerced: "false" },
  { label: "true", json: "true", text: "", coerced: "true" },
  { label: "zero", json: "0", text: "0", coerced: "0" },
  { label: "negative zero", json: "-0", text: "0", coerced: "0" },
  { label: "number", json: "2026", text: "2026", coerced: "2026" },
  { label: "fraction", json: "-2.5", text: "-2.5", coerced: "-2.5" },
  {
    label: "positive overflow",
    json: "1e400",
    text: "Infinity",
    coerced: "Infinity",
  },
  {
    label: "negative overflow",
    json: "-1e400",
    text: "-Infinity",
    coerced: "-Infinity",
  },
  { label: "empty string", json: '""', text: "", coerced: "" },
  {
    label: "string",
    json: '"Review NFT"',
    text: "Review NFT",
    coerced: "Review NFT",
  },
  { label: "empty array", json: "[]", text: "", coerced: "" },
  {
    label: "string array",
    json: '["Review"," NFT"]',
    text: "Review NFT",
    coerced: "Review, NFT",
  },
  {
    label: "number array",
    json: "[2026,0,-2.5]",
    text: "20260-2.5",
    coerced: "2026,0,-2.5",
  },
  {
    label: "boolean array",
    json: "[false,true,null]",
    text: "",
    coerced: "false,true,",
  },
  {
    label: "nested mixed array",
    json: '["Review",[null,false,2026,[" NFT",true]],[]]',
    text: "Review2026 NFT",
    coerced: "Review,,false,2026, NFT,true,",
  },
];

const nestMetadataJSON = (json: string, depth = 2500) =>
  `${"[".repeat(depth)}${json}${"]".repeat(depth)}`;

const parseMetadataJSON = (json: string): unknown => JSON.parse(json);

// Validation must preserve the depth and branch shapes accepted by the renderer.
// Exercise every metadata consumer through gallery JSON and direct route state.
const nestedMetadataCases = [
  {
    label: "2,500 nested arrays",
    json: nestMetadataJSON('"Nested NFT"'),
    text: "Nested NFT",
    coerced: "Nested NFT",
  },
  {
    label: "nested mixed children and siblings",
    json: `["Before",${nestMetadataJSON('[null,false,7,true,[" inside"],[]]')},"After"]`,
    text: "Before7 insideAfter",
    coerced: "Before,,false,7,true, inside,,After",
  },
  {
    label: "nested empty arrays",
    json: nestMetadataJSON("[]"),
    text: "",
    coerced: "",
  },
  {
    label: "multiple deep branches with surrounding siblings",
    json: `["Before",${nestMetadataJSON('["Left",null]')},"Between",${nestMetadataJSON('[false,"Right"]')},"After"]`,
    text: "BeforeLeftBetweenRightAfter",
    coerced: "Before,Left,,Between,false,Right,After",
  },
];

const sharedMetadataChildren = ["Shared", [7, null]];
const sharedNestedMetadataChildren = parseMetadataJSON(
  nestMetadataJSON('["Shared",[7,null]]'),
);
const sparseNestedMetadataChildren: unknown[] = [];
sparseNestedMetadataChildren[2] = parseMetadataJSON(
  nestMetadataJSON('["Sparse",[7,null]]'),
);
const cyclicMetadataChildren: unknown[] = ["Unreadable"];
cyclicMetadataChildren.push(cyclicMetadataChildren);
const indirectCyclicMetadataChildren: unknown[] = ["Unreadable"];
indirectCyclicMetadataChildren.push([indirectCyclicMetadataChildren]);

const isolatedMetadataCases: {
  label: string;
  fields: Record<string, unknown>;
  name?: string;
  description?: string;
  rows?: string[];
}[] = [
  { label: "invalid name", fields: { name: {} }, name: "" },
  {
    label: "invalid description",
    fields: { description: {} },
    description: "",
  },
  { label: "invalid image", fields: { image: [] } },
  ...[{}, "attributes", 7, true].map((attributes) => ({
    label: `invalid attribute collection ${JSON.stringify(attributes)}`,
    fields: { attributes },
    rows: [],
  })),
  ...[null, undefined].map((attribute) => ({
    label: `invalid attribute entry ${JSON.stringify(attribute)}`,
    fields: {
      attributes: [
        { trait_type: "Color", value: "Blue" },
        attribute,
        { trait_type: "Rarity", value: "Legendary" },
      ],
    },
  })),
  ...[{}, ["readable", {}]].map((trait_type) => ({
    label: `invalid attribute label ${JSON.stringify(trait_type)}`,
    fields: {
      attributes: [
        { trait_type: "Color", value: "Blue" },
        { trait_type, value: "Evolved" },
        { trait_type: "Rarity", value: "Legendary" },
      ],
    },
    rows: ["ColorBlue", "Evolved", "RarityLegendary"],
  })),
  {
    label: "unreadable attribute value",
    fields: {
      attributes: [
        { trait_type: "Color", value: "Blue" },
        { trait_type: "Evolution", value: { toString: null } },
        { trait_type: "Rarity", value: "Legendary" },
      ],
    },
  },
];

describe("NFTDetail", () => {
  afterEach(() => {
    cleanup();
    navigate.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const renderComponent = (
    state: unknown = defaultState,
    mockedStoreValues = mockedStore(),
  ) =>
    render(
      <StoreProvider value={mockedStoreValues}>
        <MemoryRouter initialEntries={[{ pathname: "/nft-detail", state }]}>
          <NFTDetail />
        </MemoryRouter>
      </StoreProvider>,
    );

  // A direct location also supports input beyond memory history's JSON encoding.
  const renderRouteState = (state: unknown, component = <NFTDetail />) =>
    render(
      <StoreProvider value={mockedStore()}>
        <Router
          location={{ pathname: "/nft-detail", state }}
          navigator={{
            createHref: () => "/nft-detail",
            go: vi.fn(),
            push: vi.fn(),
            replace: vi.fn(),
          }}
        >
          {component}
        </Router>
      </StoreProvider>,
    );

  const expectTransferHistory = async (
    state: unknown,
    standard: NFTStandard,
    name: string,
  ) => {
    const addTransaction = vi
      .fn<StoreType["transactionHistoryStore"]["addTransaction"]>()
      .mockResolvedValue(undefined);
    const transferStore = mockedStore({
      qrlStore: {
        signNftTransfer: () =>
          Promise.resolve({
            transactionHash: "0xreview",
            rawTransaction: "0xraw",
            error: "",
          }),
        getErc1155TokenBalance: () => Promise.resolve("2"),
      },
      transactionHistoryStore: { addTransaction },
    });
    cleanup();
    navigate.mockClear();
    render(
      <StoreProvider value={transferStore}>
        <MemoryRouter initialEntries={[{ pathname: "/nft-transfer", state }]}>
          <NFTTransfer />
        </MemoryRouter>
      </StoreProvider>,
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "receiverAddress" }),
      toChecksumAddress(`Q${"c".repeat(128)}`),
    );
    if (standard === "ZRC1155") {
      const amount = screen.getByRole("textbox", { name: "amount" });
      await userEvent.clear(amount);
      await userEvent.type(amount, "2");
    }
    const sendButton = screen.getByRole("button", { name: "Send NFT" });
    await waitFor(() => {
      expect(sendButton).toBeEnabled();
    });
    await userEvent.click(sendButton);
    await waitFor(() => {
      expect(addTransaction).toHaveBeenCalledExactlyOnceWith(
        transferStore.qrlStore.activeAccount.accountAddress,
        expect.objectContaining({
          tokenName: `${name} #42${standard === "ZRC1155" ? " ×2" : ""}`,
          tokenSymbol: defaultState.collectionName,
          tokenContractAddress: defaultState.contractAddress,
        }),
      );
    });
  };

  const expectPreservedMetadata = async (
    state: unknown,
    standard: NFTStandard,
    {
      name = defaultState.metadata.name,
      description = defaultState.metadata.description,
      rows = ["ColorBlue", "RarityLegendary"],
    }: { name?: string; description?: string; rows?: string[] } = {},
  ) => {
    const originalState = structuredClone(state);
    renderComponent(state);
    expect(
      screen.getByRole("heading", { name: name || "TestCollection #42" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: name || "#42" })).toHaveAttribute(
      "src",
      defaultState.imageUrl,
    );
    if (description) {
      expect(screen.getByText(description)).toBeInTheDocument();
    } else {
      expect(screen.queryByText("Description")).not.toBeInTheDocument();
    }
    const attributeGrid = screen.queryByText("Attributes")?.nextElementSibling;
    expect(
      Array.from(attributeGrid?.children ?? [], (card) => card.textContent),
    ).toEqual(rows);
    await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith(ROUTES.NFT_TRANSFER, {
      state: {
        contractAddress: defaultState.contractAddress,
        tokenId: defaultState.tokenId,
        collectionName: defaultState.collectionName,
        imageUrl: defaultState.imageUrl,
        nftName: name,
        standard,
        balance: standard === "ZRC1155" ? "2" : undefined,
      },
    });
    const transferState: unknown = navigate.mock.calls[0]?.[1]?.state;
    await expectTransferHistory(
      transferState,
      standard,
      name || defaultState.collectionName,
    );
    expect(state).toStrictEqual(originalState);
  };

  const galleryStateFromJSON = async (body: string, standard: NFTStandard) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      <StoreProvider
        value={mockedStore({
          qrlStore: {
            getNftTokenUri: () =>
              Promise.resolve("https://example.test/42.json"),
          },
        })}
      >
        <MemoryRouter>
          <NFTGalleryItem
            contractAddress={defaultState.contractAddress}
            tokenId={defaultState.tokenId}
            collectionName={defaultState.collectionName}
            standard={standard}
            balance={standard === "ZRC1155" ? "2" : undefined}
          />
        </MemoryRouter>
      </StoreProvider>,
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(container.querySelector(".animate-pulse")).toBeNull();
    });
    await userEvent.click(screen.getByText("Token #42"));
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate.mock.calls[0]?.[0]).toBe(ROUTES.NFT_DETAIL);
    const state: unknown = navigate.mock.calls[0]?.[1]?.state;
    cleanup();
    navigate.mockClear();
    return state;
  };

  describe.each<NFTStandard>(["ZRC721", "ZRC1155"])(
    "%s deep gallery metadata",
    (standard) => {
      // origin/dev renders this response and forwards its name to transfer.
      // A metadata guard must retain that behavior regardless of array depth.
      it("preserves the 5,056-byte gallery response through transfer", async () => {
        const body = `{"name":"Depth review","description":${nestMetadataJSON('"Deep description"')}}`;
        expect(new TextEncoder().encode(body)).toHaveLength(5056);
        const state = await galleryStateFromJSON(body, standard);
        if (!isRecord(state) || !isRecord(state.metadata)) {
          throw new Error("Expected metadata in the detail route state");
        }
        const originalDescription = state.metadata.description;
        renderRouteState(state);

        expect(
          screen.getByRole("heading", { name: "Depth review" }),
        ).toBeInTheDocument();
        expect(screen.getByText("Deep description")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
        expect(navigate).toHaveBeenCalledExactlyOnceWith(ROUTES.NFT_TRANSFER, {
          state: {
            contractAddress: defaultState.contractAddress,
            tokenId: defaultState.tokenId,
            collectionName: defaultState.collectionName,
            imageUrl: "",
            nftName: "Depth review",
            standard,
            balance: standard === "ZRC1155" ? "2" : undefined,
          },
        });
        expect(state.metadata.description).toBe(originalDescription);
        const transferState: unknown = navigate.mock.calls[0]?.[1]?.state;
        await expectTransferHistory(transferState, standard, "Depth review");
      });

      it.each([2500, 10000])(
        "renders name, description and value nested %i levels and opens transfer",
        async (depth) => {
          const body = `{"name":${nestMetadataJSON('"Deep NFT"', depth)},"description":${nestMetadataJSON('"Deep description"', depth)},"image":${JSON.stringify(defaultState.imageUrl)},"attributes":[{"trait_type":"Depth","value":${nestMetadataJSON('"Deep value"', depth)}}]}`;
          const state = await galleryStateFromJSON(body, standard);
          if (!isRecord(state) || !isRecord(state.metadata)) {
            throw new Error("Expected metadata in the detail route state");
          }

          // Supply location directly to keep the test router's JSON encoding from
          // imposing its own depth limit on fetched metadata.
          renderRouteState(state);
          expect(
            screen.getByRole("heading", { name: "Deep NFT" }),
          ).toBeInTheDocument();
          expect(screen.getByRole("img", { name: "Deep NFT" })).toHaveAttribute(
            "src",
            defaultState.imageUrl,
          );
          expect(screen.getByText("Deep description")).toBeInTheDocument();
          expect(screen.getByText("Deep value")).toBeInTheDocument();
          const transferButton = screen.getByRole("button", {
            name: "Send NFT",
          });
          expect(transferButton).toBeInTheDocument();
          await userEvent.click(transferButton);
          expect(navigate.mock.calls[0]?.[0]).toBe(ROUTES.NFT_TRANSFER);
          const transferState: unknown = navigate.mock.calls[0]?.[1]?.state;
          if (!isRecord(transferState)) {
            throw new Error("Expected transfer route state");
          }
          expect(transferState.nftName).toBe(state.metadata.name);
          cleanup();
          renderRouteState(transferState, <NFTTransfer />);
          expect(screen.getByText("Deep NFT")).toBeInTheDocument();
          expect(screen.getByRole("img", { name: "Deep NFT" })).toHaveAttribute(
            "src",
            defaultState.imageUrl,
          );
          expect(
            screen.getByRole("button", { name: "Send NFT" }),
          ).toBeInTheDocument();
        },
      );
    },
  );

  it("renders 10,000 nested arrays in every detail metadata consumer", () => {
    const metadata = parseMetadataJSON(
      `{"name":${nestMetadataJSON('"Deep NFT"', 10000)},"description":${nestMetadataJSON('"Deep description"', 10000)},"attributes":[{"trait_type":${nestMetadataJSON('"Depth"', 10000)},"value":${nestMetadataJSON('"Deep value"', 10000)}}]}`,
    );
    renderRouteState({ ...defaultState, metadata });
    expect(
      screen.getByRole("heading", { name: "Deep NFT" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Deep NFT" })).toHaveAttribute(
      "src",
      defaultState.imageUrl,
    );
    expect(screen.getByText("Deep description")).toBeInTheDocument();
    expect(screen.getByText("Depth")).toBeInTheDocument();
    expect(screen.getByText("Deep value")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Send NFT" }),
    ).toBeInTheDocument();
  });

  const expectRenderableMetadata = async (
    state: unknown,
    standard: NFTStandard,
    value: unknown,
    text: string,
    coerced: string,
  ) => {
    const originalState = structuredClone(state);
    const { container } = renderComponent(state);
    const heading = value ? text : "TestCollection #42";
    if (heading) {
      expect(screen.getByRole("heading")).toHaveTextContent(heading, {
        normalizeWhitespace: false,
      });
    } else {
      expect(screen.getByRole("heading")).toBeEmptyDOMElement();
    }
    expect(container.querySelector(".space-y-4 img")?.getAttribute("alt")).toBe(
      value === true ? null : value ? coerced : "#42",
    );
    const descriptionLabel = screen.queryByText("Description");
    if (value) {
      expect(descriptionLabel).toBeInTheDocument();
      expect(descriptionLabel?.nextElementSibling?.textContent).toBe(text);
    } else {
      expect(descriptionLabel).not.toBeInTheDocument();
    }
    // The original `description && ...` expression renders falsy numbers.
    const content = container.querySelector(".space-y-4");
    expect(
      Array.from(content?.childNodes ?? [])
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent),
    ).toEqual(typeof value === "number" && !value ? [text] : []);
    expect(
      Array.from(
        screen.getByText("Attributes").nextElementSibling?.children ?? [],
        (card) => card.textContent,
      ),
    ).toEqual(["ColorBlue", `${text}Evolved`, "RarityLegendary"]);
    await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith(ROUTES.NFT_TRANSFER, {
      state: {
        contractAddress: defaultState.contractAddress,
        tokenId: defaultState.tokenId,
        collectionName: defaultState.collectionName,
        imageUrl: defaultState.imageUrl,
        nftName: value ?? "",
        standard,
        balance: standard === "ZRC1155" ? "2" : undefined,
      },
    });
    const transferState: unknown = navigate.mock.calls[0]?.[1]?.state;
    await expectTransferHistory(
      transferState,
      standard,
      value ? coerced : defaultState.collectionName,
    );
    expect(state).toStrictEqual(originalState);
  };

  const expectNestedMetadata = async (
    state: unknown,
    standard: NFTStandard,
    field: string,
    text: string,
    coerced: string,
  ) => {
    if (!isRecord(state) || !isRecord(state.metadata)) {
      throw new Error("Expected metadata in the detail route state");
    }
    // JSON serialization and reference identity avoid recursive test matchers
    // imposing their own depth limit on the renderer's accepted inputs.
    const originalState = JSON.stringify(state);
    const consoleError = vi.spyOn(console, "error");
    const { container } = renderComponent(state);
    expect(
      screen.getByRole("heading", {
        name: field === "name" ? text : defaultState.metadata.name,
      }),
    ).toBeInTheDocument();
    expect(container.querySelector(".space-y-4 img")).toHaveAttribute(
      "alt",
      field === "name" ? coerced : defaultState.metadata.name,
    );
    expect(consoleError).not.toHaveBeenCalled();
    expect(
      screen.getByText("Description").nextElementSibling?.textContent,
    ).toBe(field === "description" ? text : defaultState.metadata.description);
    expect(
      Array.from(
        screen.getByText("Attributes").nextElementSibling?.children ?? [],
        (card) => card.textContent,
      ),
    ).toEqual([
      "ColorBlue",
      `${field === "trait_type" ? text : "Depth"}${field === "value" ? coerced : "Evolved"}`,
      "RarityLegendary",
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate.mock.calls[0]?.[0]).toBe(ROUTES.NFT_TRANSFER);
    const transferState: unknown = navigate.mock.calls[0]?.[1]?.state;
    if (!isRecord(transferState)) {
      throw new Error("Expected transfer route state");
    }
    expect(transferState.nftName).toBe(state.metadata.name);
    expect({ ...transferState, nftName: undefined }).toEqual({
      contractAddress: defaultState.contractAddress,
      tokenId: defaultState.tokenId,
      collectionName: defaultState.collectionName,
      imageUrl: defaultState.imageUrl,
      nftName: undefined,
      standard,
      balance: standard === "ZRC1155" ? "2" : undefined,
    });
    expect(JSON.stringify(state)).toBe(originalState);
    await expectTransferHistory(
      transferState,
      standard,
      field === "name" ? coerced : defaultState.metadata.name,
    );
  };

  it("should render NFT name from metadata", () => {
    renderComponent();
    expect(screen.getByText("Cool NFT #42")).toBeInTheDocument();
  });

  it("should render description", () => {
    renderComponent();
    expect(screen.getByText("A very cool NFT")).toBeInTheDocument();
  });

  it("should render collection name", () => {
    renderComponent();
    expect(screen.getByText("TestCollection")).toBeInTheDocument();
  });

  it("should render token ID", () => {
    renderComponent();
    expect(screen.getByText("#42")).toBeInTheDocument();
  });

  it("should render attributes", () => {
    renderComponent();
    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.getByText("Blue")).toBeInTheDocument();
    expect(screen.getByText("Rarity")).toBeInTheDocument();
    expect(screen.getByText("Legendary")).toBeInTheDocument();
  });

  it("should render image when imageUrl is provided", () => {
    renderComponent();
    const img = screen.getByAltText("Cool NFT #42");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://ipfs.io/ipfs/QmImage");
  });

  it("should render send NFT button", () => {
    renderComponent();
    expect(screen.getByText("Send NFT")).toBeInTheDocument();
  });

  it("should show fallback name when no metadata", () => {
    renderComponent({
      ...defaultState,
      metadata: null,
      imageUrl: "",
    });
    expect(screen.getByText("TestCollection #42")).toBeInTheDocument();
  });

  it("should have a back button", () => {
    renderComponent();
    expect(screen.getByTestId("backButtonTestId")).toBeInTheDocument();
  });

  it.each(["ZRC721", "ZRC1155"])(
    "preserves %s transfer details",
    async (standard) => {
      renderComponent({ ...defaultState, standard, balance: "2" });
      expect(screen.getByText("2")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
      expect(navigate).toHaveBeenCalledWith(ROUTES.NFT_TRANSFER, {
        state: {
          contractAddress: defaultState.contractAddress,
          tokenId: defaultState.tokenId,
          collectionName: defaultState.collectionName,
          imageUrl: defaultState.imageUrl,
          nftName: defaultState.metadata.name,
          standard,
          balance: "2",
        },
      });
    },
  );

  it("keeps the legacy standard default and numeric metadata attributes", async () => {
    renderComponent({
      ...defaultState,
      metadata: { attributes: [{ trait_type: "Level", value: 0 }] },
    });
    expect(screen.getByText("TestCollection #42")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("ZRC-721")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
    expect(navigate).toHaveBeenCalledWith(ROUTES.NFT_TRANSFER, {
      state: {
        contractAddress: defaultState.contractAddress,
        tokenId: defaultState.tokenId,
        collectionName: defaultState.collectionName,
        imageUrl: defaultState.imageUrl,
        standard: "ZRC721",
        balance: undefined,
        nftName: "",
      },
    });
  });

  describe.each<NFTStandard>(["ZRC721", "ZRC1155"])(
    "%s valid metadata compatibility",
    (standard) => {
      describe.each(["gallery JSON", "route state"])(
        "accepted metadata from %s",
        (source) => {
          describe.each(["name", "description", "trait_type", "value"])(
            "nested metadata compatibility for %s",
            (field) => {
              it.each(nestedMetadataCases)(
                "preserves $label through display, transfer and history",
                async ({ json, text, coerced }) => {
                  const value: unknown = JSON.parse(json);
                  const metadata = {
                    name: field === "name" ? value : defaultState.metadata.name,
                    description:
                      field === "description"
                        ? value
                        : defaultState.metadata.description,
                    image: defaultState.imageUrl,
                    attributes: [
                      { trait_type: "Color", value: "Blue" },
                      {
                        trait_type: field === "trait_type" ? value : "Depth",
                        value: field === "value" ? value : "Evolved",
                      },
                      { trait_type: "Rarity", value: "Legendary" },
                    ],
                  };
                  const state =
                    source === "gallery JSON"
                      ? await galleryStateFromJSON(
                          JSON.stringify(metadata),
                          standard,
                        )
                      : {
                          ...defaultState,
                          metadata,
                          standard,
                          balance: standard === "ZRC1155" ? "2" : undefined,
                        };
                  await expectNestedMetadata(
                    state,
                    standard,
                    field,
                    text,
                    coerced,
                  );
                },
              );
            },
          );
          describe.each(["name", "description"])(
            "image-free metadata depth compatibility for %s",
            (field) => {
              it.each([2500, 3000])(
                "preserves %i nested arrays through display and transfer navigation",
                async (depth) => {
                  const consoleError = vi.spyOn(console, "error");
                  const nestedJSON = nestMetadataJSON('"Nested NFT"', depth);
                  const body = `{"name":${field === "name" ? nestedJSON : JSON.stringify(defaultState.metadata.name)},"description":${field === "description" ? nestedJSON : JSON.stringify(defaultState.metadata.description)}}`;
                  const state: unknown =
                    source === "gallery JSON"
                      ? await galleryStateFromJSON(body, standard)
                      : {
                          ...defaultState,
                          metadata: parseMetadataJSON(body),
                          imageUrl: "",
                          standard,
                          balance: standard === "ZRC1155" ? "2" : undefined,
                        };
                  if (!isRecord(state) || !isRecord(state.metadata)) {
                    throw new Error(
                      "Expected metadata in the detail route state",
                    );
                  }
                  const metadata = state.metadata;
                  const value = metadata[field];
                  const { container } = renderRouteState(state);
                  expect(screen.getByRole("heading")).toHaveTextContent(
                    field === "name"
                      ? "Nested NFT"
                      : defaultState.metadata.name,
                  );
                  expect(
                    screen.getByText("Description").nextElementSibling
                      ?.textContent,
                  ).toBe(
                    field === "description"
                      ? "Nested NFT"
                      : defaultState.metadata.description,
                  );
                  expect(container.querySelector(".space-y-4 img")).toBeNull();
                  await userEvent.click(
                    screen.getByRole("button", { name: "Send NFT" }),
                  );
                  expect(navigate).toHaveBeenCalledOnce();
                  expect(navigate.mock.calls[0]?.[0]).toBe(ROUTES.NFT_TRANSFER);
                  const transferState: unknown =
                    navigate.mock.calls[0]?.[1]?.state;
                  if (!isRecord(transferState)) {
                    throw new Error("Expected transfer route state");
                  }
                  expect(transferState.nftName).toBe(metadata.name);
                  expect({ ...transferState, nftName: undefined }).toEqual({
                    contractAddress: defaultState.contractAddress,
                    tokenId: defaultState.tokenId,
                    collectionName: defaultState.collectionName,
                    imageUrl: "",
                    nftName: undefined,
                    standard,
                    balance: standard === "ZRC1155" ? "2" : undefined,
                  });
                  expect(state.metadata).toBe(metadata);
                  expect(metadata[field]).toBe(value);
                  expect(consoleError).not.toHaveBeenCalled();
                },
              );
            },
          );
          it.each(metadataTextCases)(
            "preserves name, description, trait label and history: $label",
            async ({ json, text, coerced }) => {
              const value: unknown =
                json === undefined ? undefined : JSON.parse(json);
              const state =
                source === "gallery JSON"
                  ? await galleryStateFromJSON(
                      `{${json === undefined ? "" : `"name":${json},"description":${json},`}"image":${JSON.stringify(defaultState.imageUrl)},"attributes":[{"trait_type":"Color","value":"Blue"},{${json === undefined ? "" : `"trait_type":${json},`}"value":"Evolved"},{"trait_type":"Rarity","value":"Legendary"}]}`,
                      standard,
                    )
                  : {
                      ...defaultState,
                      standard,
                      balance: standard === "ZRC1155" ? "2" : undefined,
                      metadata: {
                        name: value,
                        description: value,
                        attributes: [
                          { trait_type: "Color", value: "Blue" },
                          { trait_type: value, value: "Evolved" },
                          { trait_type: "Rarity", value: "Legendary" },
                        ],
                      },
                    };
              await expectRenderableMetadata(
                state,
                standard,
                value,
                text,
                coerced,
              );
            },
          );
          it.each(['"attribute"', "7", "0", "true", "false", "[]", "[null]"])(
            "preserves readable primitive and array attribute entries: %s",
            async (json) => {
              const attribute: unknown = JSON.parse(json);
              const metadata = {
                ...defaultState.metadata,
                image: defaultState.imageUrl,
                attributes: [
                  { trait_type: "Color", value: "Blue" },
                  attribute,
                  { trait_type: "Rarity", value: "Legendary" },
                ],
              };
              const state =
                source === "gallery JSON"
                  ? await galleryStateFromJSON(
                      JSON.stringify(metadata),
                      standard,
                    )
                  : {
                      ...defaultState,
                      metadata,
                      standard,
                      balance: standard === "ZRC1155" ? "2" : undefined,
                    };
              await expectPreservedMetadata(state, standard, {
                rows: ["ColorBlue", "undefined", "RarityLegendary"],
              });
            },
          );
        },
      );
      describe.each(["name", "description", "trait_type", "value"])(
        "nested route graph compatibility for %s",
        (field) => {
          it.each([
            {
              label: "shared deep children",
              value: [
                sharedNestedMetadataChildren,
                sharedNestedMetadataChildren,
              ],
              text: "Shared7Shared7",
              coerced: "Shared,7,,Shared,7,",
            },
            {
              label: "sparse deep children",
              value: sparseNestedMetadataChildren,
              text: "Sparse7",
              coerced: ",,Sparse,7,",
            },
          ])(
            "preserves $label through display, transfer and history",
            async ({ value, text, coerced }) => {
              const metadata = {
                name: field === "name" ? value : defaultState.metadata.name,
                description:
                  field === "description"
                    ? value
                    : defaultState.metadata.description,
                attributes: [
                  { trait_type: "Color", value: "Blue" },
                  {
                    trait_type: field === "trait_type" ? value : "Depth",
                    value: field === "value" ? value : "Evolved",
                  },
                  { trait_type: "Rarity", value: "Legendary" },
                ],
              };
              await expectNestedMetadata(
                {
                  ...defaultState,
                  metadata,
                  standard,
                  balance: standard === "ZRC1155" ? "2" : undefined,
                },
                standard,
                field,
                text,
                coerced,
              );
              if (field === "trait_type" || field === "value") {
                expect(metadata.attributes[1]?.[field]).toBe(value);
              } else {
                expect(
                  field === "name" ? metadata.name : metadata.description,
                ).toBe(value);
              }
            },
          );
        },
      );
      it.each([
        { label: "NaN", value: Number.NaN, text: "NaN", coerced: "NaN" },
        {
          label: "shared array children",
          value: [sharedMetadataChildren, sharedMetadataChildren],
          text: "Shared7Shared7",
          coerced: "Shared,7,,Shared,7,",
        },
        {
          label: "undefined array entries",
          value: [undefined, "NFT", [undefined, 2026]],
          text: "NFT2026",
          coerced: ",NFT,,2026",
        },
        {
          label: "undefined-only array",
          value: [undefined],
          text: "",
          coerced: "",
        },
      ])(
        "preserves accepted metadata in route state: $label",
        async ({ value, text, coerced }) => {
          await expectRenderableMetadata(
            {
              ...defaultState,
              standard,
              balance: standard === "ZRC1155" ? "2" : undefined,
              metadata: {
                name: value,
                description: value,
                attributes: [
                  { trait_type: "Color", value: "Blue" },
                  { trait_type: value, value: "Evolved" },
                  { trait_type: "Rarity", value: "Legendary" },
                ],
              },
            },
            standard,
            value,
            text,
            coerced,
          );
        },
      );
      describe.each(["name", "description", "trait_type"])(
        "stack-safe validation of unreadable %s",
        (field) => {
          it.each([
            {
              label: "object at depth 2,500",
              value: parseMetadataJSON(nestMetadataJSON("{}")),
            },
            {
              label: "object at depth 25,000",
              value: parseMetadataJSON(nestMetadataJSON("{}", 25000)),
            },
            {
              label: "invalid sibling before nested children",
              value: [{}, parseMetadataJSON(nestMetadataJSON('"Readable"'))],
            },
            {
              label: "invalid sibling after nested children",
              value: [parseMetadataJSON(nestMetadataJSON('"Readable"')), {}],
            },
            { label: "self cycle", value: cyclicMetadataChildren },
            { label: "ancestor cycle", value: indirectCyclicMetadataChildren },
          ])(
            "isolates $label and preserves the other fields",
            async ({ value }) => {
              const metadata = {
                name: field === "name" ? value : defaultState.metadata.name,
                description:
                  field === "description"
                    ? value
                    : defaultState.metadata.description,
                attributes: [
                  { trait_type: "Color", value: "Blue" },
                  {
                    trait_type: field === "trait_type" ? value : "Depth",
                    value: "Evolved",
                  },
                  { trait_type: "Rarity", value: "Legendary" },
                ],
              };
              const state = {
                ...defaultState,
                metadata,
                standard,
                balance: standard === "ZRC1155" ? "2" : undefined,
              };
              // Memory history formats its initial entries as JSON. Supply the
              // location directly to exercise structured-cloneable cycles too.
              renderRouteState(state);
              const name = field === "name" ? "" : defaultState.metadata.name;
              expect(
                screen.getByRole("heading", {
                  name: name || "TestCollection #42",
                }),
              ).toBeInTheDocument();
              expect(
                screen.getByRole("img", { name: name || "#42" }),
              ).toHaveAttribute("src", defaultState.imageUrl);
              if (field === "description") {
                expect(
                  screen.queryByText("Description"),
                ).not.toBeInTheDocument();
              } else {
                expect(
                  screen.getByText(defaultState.metadata.description),
                ).toBeInTheDocument();
              }
              expect(
                Array.from(
                  screen.getByText("Attributes").nextElementSibling?.children ??
                    [],
                  (card) => card.textContent,
                ),
              ).toEqual([
                "ColorBlue",
                `${field === "trait_type" ? "" : "Depth"}Evolved`,
                "RarityLegendary",
              ]);
              await userEvent.click(
                screen.getByRole("button", { name: "Send NFT" }),
              );
              expect(navigate).toHaveBeenCalledExactlyOnceWith(
                ROUTES.NFT_TRANSFER,
                {
                  state: {
                    contractAddress: defaultState.contractAddress,
                    tokenId: defaultState.tokenId,
                    collectionName: defaultState.collectionName,
                    imageUrl: defaultState.imageUrl,
                    nftName: name,
                    standard,
                    balance: state.balance,
                  },
                },
              );
              expect(state.metadata).toBe(metadata);
              if (field === "trait_type") {
                expect(metadata.attributes[1]?.trait_type).toBe(value);
              } else {
                expect(
                  field === "name" ? metadata.name : metadata.description,
                ).toBe(value);
              }
            },
          );
        },
      );
      it.each(jsonAttributeCases)(
        "preserves coercible gallery attribute values: $label",
        async ({ json, text }) => {
          const props = {
            contractAddress: defaultState.contractAddress,
            tokenId: defaultState.tokenId,
            collectionName: defaultState.collectionName,
            standard,
            balance: standard === "ZRC1155" ? "2" : undefined,
          };
          const fields = Object.entries({
            ...defaultState.metadata,
            image: defaultState.imageUrl,
          })
            .filter(([key]) => key !== "attributes")
            .map(
              ([key, value]) =>
                `${JSON.stringify(key)}:${JSON.stringify(value)}`,
            );
          const attribute = `{"trait_type":"Evolution"${json === undefined ? "" : `,"value":${json}`}}`;
          const body = `{${fields.join(",")},"attributes":[{"trait_type":"Color","value":"Blue"},${attribute},{"trait_type":"Rarity","value":"Legendary"}]}`;
          vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>().mockResolvedValue(
              new Response(body, {
                headers: { "Content-Type": "application/json" },
              }),
            ),
          );
          render(
            <StoreProvider
              value={mockedStore({
                qrlStore: {
                  getNftTokenUri: () =>
                    Promise.resolve("https://example.test/42.json"),
                },
              })}
            >
              <MemoryRouter>
                <NFTGalleryItem {...props} />
              </MemoryRouter>
            </StoreProvider>,
          );
          await userEvent.click(
            await screen.findByText(defaultState.metadata.name),
          );
          expect(navigate).toHaveBeenCalledOnce();
          expect(navigate.mock.calls[0]?.[0]).toBe(ROUTES.NFT_DETAIL);
          const state: unknown = navigate.mock.calls[0]?.[1]?.state;
          cleanup();
          navigate.mockClear();
          await expectPreservedMetadata(state, standard, {
            rows: ["ColorBlue", `Evolution${text}`, "RarityLegendary"],
          });
        },
      );
      it.each([
        { label: "undefined", value: undefined, text: "undefined" },
        { label: "NaN", value: Number.NaN, text: "NaN" },
        {
          label: "Infinity",
          value: Number.POSITIVE_INFINITY,
          text: "Infinity",
        },
        {
          label: "negative Infinity",
          value: Number.NEGATIVE_INFINITY,
          text: "-Infinity",
        },
      ])(
        "preserves coercible route attribute values: $label",
        async ({ value, text }) => {
          await expectPreservedMetadata(
            {
              ...defaultState,
              standard,
              balance: standard === "ZRC1155" ? "2" : undefined,
              metadata: {
                ...defaultState.metadata,
                attributes: [
                  { trait_type: "Color", value: "Blue" },
                  { trait_type: "Evolution", value },
                  { trait_type: "Rarity", value: "Legendary" },
                ],
              },
            },
            standard,
            { rows: ["ColorBlue", `Evolution${text}`, "RarityLegendary"] },
          );
        },
      );
      it.each(isolatedMetadataCases)(
        "isolates malformed metadata fields: $label",
        async ({ fields, ...expected }) => {
          await expectPreservedMetadata(
            {
              ...defaultState,
              standard,
              balance: standard === "ZRC1155" ? "2" : undefined,
              metadata: { ...defaultState.metadata, ...fields },
            },
            standard,
            expected,
          );
        },
      );
      it.each(attributeCases)(
        "preserves gallery metadata and transfer details for $label",
        async ({ attributes }) => {
          const props = {
            contractAddress: defaultState.contractAddress,
            tokenId: defaultState.tokenId,
            collectionName: defaultState.collectionName,
            standard,
            balance: standard === "ZRC1155" ? "2" : undefined,
          };
          const metadata = {
            name: defaultState.metadata.name,
            description: defaultState.metadata.description,
            image: "https://example.test/42.png",
            attributes,
          };
          const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify(metadata), {
              headers: { "Content-Type": "application/json" },
            }),
          );
          vi.stubGlobal("fetch", fetchMock);
          render(
            <StoreProvider
              value={mockedStore({
                qrlStore: {
                  getNftTokenUri: () =>
                    Promise.resolve("https://example.test/42.json"),
                },
              })}
            >
              <MemoryRouter>
                <NFTGalleryItem {...props} />
              </MemoryRouter>
            </StoreProvider>,
          );
          await userEvent.click(await screen.findByText(metadata.name));
          expect(fetchMock).toHaveBeenCalledOnce();
          expect(navigate).toHaveBeenCalledWith(ROUTES.NFT_DETAIL, {
            state: { ...props, metadata, imageUrl: metadata.image },
          });
          const detailState: unknown = navigate.mock.calls[0]?.[1]?.state;
          const originalDetailState = structuredClone(detailState);
          cleanup();
          navigate.mockClear();

          renderComponent(detailState);
          expect(screen.getByText(metadata.name)).toBeInTheDocument();
          expect(screen.getByText(metadata.description)).toBeInTheDocument();
          expect(
            screen.getByRole("img", { name: metadata.name }),
          ).toHaveAttribute("src", metadata.image);
          if (attributes?.length) {
            const attributeGrid =
              screen.getByText("Attributes").nextElementSibling;
            expect(
              Array.from(
                attributeGrid?.children ?? [],
                (card) => card.textContent,
              ),
            ).toEqual(
              attributes.map(
                (attribute) =>
                  `${attribute.trait_type ?? ""}${attribute.value}`,
              ),
            );
          } else {
            expect(screen.queryByText("Attributes")).not.toBeInTheDocument();
          }
          await userEvent.click(
            screen.getByRole("button", { name: "Send NFT" }),
          );
          expect(navigate).toHaveBeenCalledExactlyOnceWith(
            ROUTES.NFT_TRANSFER,
            {
              state: {
                ...props,
                imageUrl: metadata.image,
                nftName: metadata.name,
              },
            },
          );
          expect(detailState).toStrictEqual(originalDetailState);
          const transferState: unknown = navigate.mock.calls[0]?.[1]?.state;
          await expectTransferHistory(transferState, standard, metadata.name);
          expect(detailState).toStrictEqual(originalDetailState);
        },
      );
      it.each(nullableMetadataCases)(
        "preserves nullable gallery metadata and history for $label",
        async ({ metadata }) => {
          const props = {
            contractAddress: defaultState.contractAddress,
            tokenId: defaultState.tokenId,
            collectionName: defaultState.collectionName,
            standard,
            balance: standard === "ZRC1155" ? "2" : undefined,
          };
          const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify(metadata), {
              headers: { "Content-Type": "application/json" },
            }),
          );
          vi.stubGlobal("fetch", fetchMock);
          const { container } = render(
            <StoreProvider
              value={mockedStore({
                qrlStore: {
                  getNftTokenUri: () =>
                    Promise.resolve("https://example.test/42.json"),
                },
              })}
            >
              <MemoryRouter>
                <NFTGalleryItem {...props} />
              </MemoryRouter>
            </StoreProvider>,
          );
          await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledOnce();
            expect(container.querySelector(".animate-pulse")).toBeNull();
          });
          await userEvent.click(screen.getByText(metadata.name || "#42"));
          expect(navigate).toHaveBeenCalledExactlyOnceWith(ROUTES.NFT_DETAIL, {
            state: { ...props, metadata, imageUrl: metadata.image ?? "" },
          });
          const detailState: unknown = navigate.mock.calls[0]?.[1]?.state;
          const originalDetailState = structuredClone(detailState);
          cleanup();
          navigate.mockClear();

          renderComponent(detailState);
          expect(
            screen.getByRole("heading", {
              name: metadata.name || "TestCollection #42",
            }),
          ).toBeInTheDocument();
          if (metadata.description) {
            expect(screen.getByText(metadata.description)).toBeInTheDocument();
          } else {
            expect(screen.queryByText("Description")).not.toBeInTheDocument();
          }
          if (metadata.image) {
            expect(
              screen.getByRole("img", { name: metadata.name || "#42" }),
            ).toHaveAttribute("src", metadata.image);
          } else {
            expect(screen.queryByRole("img")).not.toBeInTheDocument();
          }
          const attributeGrid =
            screen.getByText("Attributes").nextElementSibling;
          expect(
            Array.from(
              attributeGrid?.children ?? [],
              (card) => card.textContent,
            ),
          ).toEqual(["ColorBlue", "RarityLegendary"]);
          await userEvent.click(
            screen.getByRole("button", { name: "Send NFT" }),
          );
          expect(navigate).toHaveBeenCalledExactlyOnceWith(
            ROUTES.NFT_TRANSFER,
            {
              state: {
                ...props,
                imageUrl: metadata.image ?? "",
                nftName: metadata.name ?? "",
              },
            },
          );
          const transferState: unknown = navigate.mock.calls[0]?.[1]?.state;
          await expectTransferHistory(
            transferState,
            standard,
            metadata.name || props.collectionName,
          );
          expect(detailState).toStrictEqual(originalDetailState);
        },
      );
      describe.each(absentAttributeCases)("$label", ({ fields }) => {
        it.each(optionalMetadataCases)(
          "preserves valid optional route metadata: $label",
          async ({ metadata }) => {
            const routeMetadata = metadata
              ? { ...metadata, ...fields }
              : metadata;
            const state = {
              ...defaultState,
              metadata: routeMetadata,
              standard,
              balance: standard === "ZRC1155" ? "2" : undefined,
            };
            const originalState = structuredClone(state);
            renderComponent(state);
            expect(
              screen.getByText(metadata?.name || "TestCollection #42"),
            ).toBeInTheDocument();
            expect(
              screen.getByRole("img", { name: metadata?.name || "#42" }),
            ).toHaveAttribute("src", defaultState.imageUrl);
            if (metadata?.description) {
              expect(
                screen.getByText(metadata.description),
              ).toBeInTheDocument();
            } else {
              expect(screen.queryByText("Description")).not.toBeInTheDocument();
            }
            expect(screen.queryByText("Attributes")).not.toBeInTheDocument();
            await userEvent.click(
              screen.getByRole("button", { name: "Send NFT" }),
            );
            expect(navigate).toHaveBeenCalledExactlyOnceWith(
              ROUTES.NFT_TRANSFER,
              {
                state: {
                  contractAddress: defaultState.contractAddress,
                  tokenId: defaultState.tokenId,
                  collectionName: defaultState.collectionName,
                  imageUrl: defaultState.imageUrl,
                  nftName: metadata?.name ?? "",
                  standard,
                  balance: state.balance,
                },
              },
            );
            expect(state).toStrictEqual(originalState);
          },
        );
      });
    },
  );

  it("preserves explicitly undefined trait labels in route state", () => {
    renderComponent({
      ...defaultState,
      metadata: {
        ...defaultState.metadata,
        attributes: [{ trait_type: undefined, value: "Happy" }],
      },
    });
    expect(screen.getByText(defaultState.metadata.name)).toBeInTheDocument();
    expect(screen.getByText("Happy")).toBeInTheDocument();
  });

  it.each([
    { name: {} },
    { description: {} },
    { image: [] },
    { attributes: {} },
    { attributes: [null] },
    { attributes: [{ value: { toString: null } }] },
    { attributes: Array.from({ length: 1 }) },
  ])(
    "uses safe defaults for metadata without readable fields: %j",
    async (metadata) => {
      renderComponent({ ...defaultState, metadata });
      expect(screen.getByText("TestCollection #42")).toBeInTheDocument();
      expect(screen.queryByText("Attributes")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
      expect(navigate).toHaveBeenCalledWith(ROUTES.NFT_TRANSFER, {
        state: {
          contractAddress: defaultState.contractAddress,
          tokenId: defaultState.tokenId,
          collectionName: defaultState.collectionName,
          imageUrl: defaultState.imageUrl,
          standard: "ZRC721",
          balance: undefined,
          nftName: "",
        },
      });
    },
  );

  it.each([
    null,
    17,
    "invalid",
    [],
    {
      contractAddress: {},
      tokenId: 42,
      collectionName: [],
      imageUrl: true,
      standard: "unsupported",
      balance: {},
      metadata: false,
    },
  ])("uses safe defaults for malformed route state: %j", async (state) => {
    renderComponent(state);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
    expect(navigate).toHaveBeenCalledWith(ROUTES.NFT_TRANSFER, {
      state: {
        contractAddress: "",
        tokenId: "",
        collectionName: "",
        imageUrl: "",
        nftName: "",
        standard: "ZRC721",
        balance: undefined,
      },
    });
  });

  it("shows the placeholder after an image fails", () => {
    renderComponent();
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("reports a rejected transfer navigation", async () => {
    const error = new Error("Navigation failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    navigate.mockRejectedValueOnce(error);
    renderComponent();
    await userEvent.click(screen.getByRole("button", { name: "Send NFT" }));
    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "[NFTDetail] Failed to open NFT transfer:",
        error,
      );
    });
  });
});
