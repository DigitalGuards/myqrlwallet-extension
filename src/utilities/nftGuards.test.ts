import { describe, expect, it } from "vitest";
import {
  isNFTGalleryState,
  isNFTMetadata,
  isNFTTransferState,
} from "./nftGuards";

const gallery = { contractAddress: `Q${"a".repeat(128)}` };
const transfer = { ...gallery, tokenId: "7" };

describe("NFT boundary guards", () => {
  it("accepts legacy route defaults and both NFT standards", () => {
    expect(isNFTGalleryState(gallery)).toBe(true);
    expect(isNFTTransferState(transfer)).toBe(true);
    for (const standard of [undefined, null, "ZRC721", "ZRC1155"]) {
      expect(isNFTGalleryState({ ...gallery, standard })).toBe(true);
      expect(
        isNFTTransferState({
          ...transfer,
          standard,
          nftName: null,
          imageUrl: null,
          collectionName: null,
          balance: "3",
        }),
      ).toBe(true);
    }
  });

  it.each([undefined, null, "", "Collection"])(
    "accepts optional gallery labels %j in both route guards",
    (collectionName) => {
      expect(isNFTGalleryState({ ...gallery, collectionName })).toBe(true);
      expect(isNFTTransferState({ ...transfer, collectionName })).toBe(true);
    },
  );

  it.each(["imageUrl", "nftName"])(
    "accepts omitted, null, empty and populated transfer %s",
    (field) => {
      for (const value of [undefined, null, "", "Token"]) {
        expect(isNFTTransferState({ ...transfer, [field]: value })).toBe(true);
      }
    },
  );

  it.each([undefined, "", "0", "3"])(
    "accepts optional transfer balances %j",
    (balance) => {
      expect(isNFTTransferState({ ...transfer, balance })).toBe(true);
    },
  );

  it.each([
    undefined,
    null,
    [],
    "NFT",
    {},
    { ...gallery, contractAddress: 7 },
    { ...gallery, collectionName: {} },
    { ...gallery, standard: "ZRC20" },
  ])("rejects malformed gallery state %j", (value) => {
    expect(isNFTGalleryState(value)).toBe(false);
  });

  it.each([
    gallery,
    { ...transfer, tokenId: 7 },
    { ...transfer, imageUrl: [] },
    { ...transfer, nftName: {} },
    { ...transfer, balance: 3 },
  ])("rejects malformed transfer state %j", (value) => {
    expect(isNFTTransferState(value)).toBe(false);
  });

  it("accepts optional metadata fields, extra fields and supported traits", () => {
    expect(isNFTMetadata({})).toBe(true);
    expect(
      isNFTMetadata({
        name: "Token",
        description: "A token",
        image: "ipfs://image",
        attributes: [
          { trait_type: "Color", value: "red" },
          { trait_type: "Level", value: 7 },
        ],
        extra: { value: true },
      }),
    ).toBe(true);
  });

  it.each(["name", "description", "image"])(
    "accepts omitted, empty and populated metadata %s",
    (field) => {
      for (const value of [undefined, "", "Token"]) {
        expect(isNFTMetadata({ [field]: value })).toBe(true);
      }
    },
  );

  it.each([undefined, []])(
    "accepts optional attribute arrays %j",
    (attributes) => {
      expect(isNFTMetadata({ attributes })).toBe(true);
    },
  );

  it.each(["Happy", "", 0, 7, 2.5])(
    "accepts string and numeric traits with optional labels: %j",
    (value) => {
      for (const label of [
        {},
        { trait_type: undefined },
        { trait_type: "" },
        { trait_type: "Trait" },
      ]) {
        expect(isNFTMetadata({ attributes: [{ ...label, value }] })).toBe(true);
      }
    },
  );

  it("accepts mixed traits with display hints and extra fields in their original order", () => {
    const attributes = [
      { trait_type: "Color", value: "red" },
      { value: "Happy" },
      { value: 0 },
      {
        display_type: "number",
        trait_type: "Generation",
        value: 2,
        max_value: 10,
      },
      { display_type: "date", trait_type: "Birthday", value: 1546360800 },
      { display_type: "boost_number", trait_type: "Power", value: 3 },
      { display_type: "boost_percentage", trait_type: "Stamina", value: 2.5 },
    ];
    const metadata = { name: "Token", attributes, extra: { value: true } };
    const original = structuredClone(metadata);

    expect(isNFTMetadata(metadata)).toBe(true);
    expect(metadata).toStrictEqual(original);
    expect(metadata.attributes).toBe(attributes);
  });

  it.each([
    undefined,
    null,
    [],
    { name: {} },
    { description: 4 },
    { image: [] },
    { attributes: {} },
    { attributes: [null] },
    { attributes: ["Happy"] },
    { attributes: [{}] },
    { attributes: [{ value: null }] },
    { attributes: [{ value: true }] },
    { attributes: [{ value: [] }] },
    { attributes: [{ value: {} }] },
    { attributes: [{ trait_type: null, value: "Happy" }] },
    { attributes: [{ trait_type: 7, value: "red" }] },
    { attributes: [{ trait_type: "Color", value: {} }] },
    { attributes: [{ value: "Happy" }, { trait_type: "Color", value: {} }] },
  ])("rejects malformed metadata %j", (value) => {
    expect(isNFTMetadata(value)).toBe(false);
  });
});
