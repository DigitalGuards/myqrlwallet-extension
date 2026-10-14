import { describe, expect, it } from "vitest";
import {
  isMetadataText,
  metadataTextChildren,
  metadataValueToString,
  type MetadataText,
} from "./nftMetadata";

// Every metadata consumer must retain its shallow behavior at arbitrary depth.
// Native array coercion at shallow depth is the original renderer's oracle.
describe.each([2500, 100000])("metadata at %i array levels", (depth) => {
  const cases: {
    label: string;
    value: MetadataText[];
    children: (string | number)[];
  }[] = [
    { label: "text", value: ["NFT"], children: ["NFT"] },
    { label: "empty arrays", value: [[], [[]]], children: [] },
    {
      label: "numbers",
      value: [0, -0, -2.5, Infinity, Number.NaN],
      children: [0, -0, -2.5, Infinity, Number.NaN],
    },
    {
      label: "omitted children",
      value: [null, undefined, false, true],
      children: [],
    },
    {
      label: "mixed branches",
      value: ["Before", [null, false, 7, ["Inside"], true], [], "After"],
      children: ["Before", 7, "Inside", "After"],
    },
  ];

  it.each(cases)(
    "preserves $label through validation, rendering and coercion",
    ({ value, children }) => {
      const original = structuredClone(value);
      const coerced = String(value);
      let nested: MetadataText = value;
      for (let index = 0; index < depth; index += 1) nested = [nested];

      expect(isMetadataText(nested)).toBe(true);
      expect(metadataTextChildren(nested)).toEqual(children);
      expect(metadataValueToString(nested)).toBe(coerced);
      expect(value).toEqual(original);
    },
  );
});

describe("isMetadataText", () => {
  it.each([
    { leaf: '"NFT"', valid: true },
    { leaf: "{}", valid: false },
  ])("validates 100,000 array levels above $leaf", ({ leaf, valid }) => {
    const value: unknown = JSON.parse(
      `${"[".repeat(100000)}${leaf}${"]".repeat(100000)}`,
    );
    expect(isMetadataText(value)).toBe(valid);
  });

  it("accepts shared children and rejects ancestor cycles", () => {
    const child: unknown[] = ["NFT", [7, null]];
    const shared = [child, child];
    expect(isMetadataText(shared)).toBe(true);
    child.push(shared);
    expect(isMetadataText(shared)).toBe(false);
  });

  it("rejects self cycles", () => {
    const value: unknown[] = ["NFT"];
    value.push(value);
    expect(isMetadataText(value)).toBe(false);
  });

  it("rejects a deep ancestor cycle after accepting the same shared branch", () => {
    const leaf: unknown[] = ["NFT"];
    let branch = leaf;
    for (let index = 0; index < 100000; index += 1) branch = [branch];
    const value = [branch, branch];

    expect(isMetadataText(value)).toBe(true);
    leaf.push(branch);
    expect(isMetadataText(value)).toBe(false);
    expect(value[0]).toBe(branch);
    expect(value[1]).toBe(branch);
    expect(leaf[1]).toBe(branch);
  });
});

it("preserves wide metadata arrays without using the call argument stack", () => {
  const value: MetadataText[] = Array.from({ length: 150000 }, (_, index) =>
    index % 2 === 0 ? [index, null, false] : [],
  );
  const expected = Array.from({ length: 75000 }, (_, index) => index * 2);
  const original = String(value);

  expect(isMetadataText(value)).toBe(true);
  expect(metadataTextChildren(value)).toEqual(expected);
  expect(metadataValueToString(value)).toBe(original);
  expect(value).toHaveLength(150000);
});

describe("metadataTextChildren", () => {
  it("preserves visible leaves, order and shared children", () => {
    const shared = [7, null, false, "NFT"];
    expect(
      metadataTextChildren([
        "Before",
        shared,
        [shared, undefined, []],
        "After",
      ]),
    ).toEqual(["Before", 7, "NFT", 7, "NFT", "After"]);
  });
});

describe("metadataValueToString", () => {
  const values: unknown[] = [
    undefined,
    null,
    false,
    true,
    0,
    -0,
    -2.5,
    Infinity,
    "",
    "NFT",
    [],
    [null, false, 0, { level: 1 }, ["Blue", "Gold"]],
    ["Before", [null, false, 7, true, [" inside"], []], "After"],
    { level: 1, progress: [true, null] },
  ];
  it.each(values.map((value) => ({ value })))(
    "preserves native String output for $value",
    ({ value }) => {
      expect(metadataValueToString(value)).toBe(String(value));
    },
  );

  it("preserves sparse entries, shared children and ancestor cycles", () => {
    const child: unknown[] = ["NFT"];
    const value: unknown[] = [child, child];
    value[3] = [null, undefined];
    child.push(value);
    expect(metadataValueToString(value)).toBe(String(value));
  });

  it("preserves opaque attribute values inside deep shared branches", () => {
    const leaf = ["Before", { level: 1 }, [null, false, 7], "After"];
    const text = "Before,[object Object],,false,7,After";
    let branch: unknown[] = leaf;
    for (let index = 0; index < 100000; index += 1) branch = [branch];

    expect(isMetadataText(branch)).toBe(false);
    expect(metadataValueToString([branch, branch])).toBe(`${text},${text}`);
    expect(leaf).toEqual(["Before", { level: 1 }, [null, false, 7], "After"]);
  });

  it("preserves native cycle coercion through deep shared branches", () => {
    const leaf: unknown[] = ["Before"];
    let branch = leaf;
    for (let index = 0; index < 100000; index += 1) branch = [branch];
    leaf.push(branch, "After");
    const shallow: unknown[] = ["Before"];
    shallow.push(shallow, "After");

    expect(metadataValueToString([branch, branch])).toBe(
      String([shallow, shallow]),
    );
    expect(leaf[1]).toBe(branch);
    expect(leaf[2]).toBe("After");
  });

  it("preserves failure for JSON objects with an unusable toString", () => {
    expect(() => metadataValueToString([{ toString: null }])).toThrow(
      TypeError,
    );
  });

  it("preserves native symbol coercion for scalars and array entries", () => {
    const value = Symbol("attribute");
    expect(metadataValueToString(value)).toBe(String(value));
    for (const array of [[value], ["Before", [value], "After"]]) {
      expect(() => String(array)).toThrow(TypeError);
      expect(() => metadataValueToString(array)).toThrow(TypeError);
    }
  });
});
