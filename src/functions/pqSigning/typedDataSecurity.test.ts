import { describe, expect, it } from "vitest";
import {
  baseTypeName,
  computeTypedDataDigest,
  encodeField,
  encodeType,
  hashStruct,
  TYPED_DATA_LIMITS,
  typedDataSchemeVersion,
  typeHash,
  type TypedDataPayload,
} from "./typedData";

const SIGNER = `Q${"0".repeat(128)}`;
const LEGACY_Q40 = `Q${"0".repeat(40)}`;

function payloadWith(fieldType: string, value: unknown): TypedDataPayload {
  return {
    types: {
      QRLDomain: [{ name: "name", type: "string" }],
      Payload: [{ name: "value", type: fieldType }],
    },
    primaryType: "Payload",
    domain: { name: "Security test" },
    message: { value },
  };
}

describe("typed data base type names", () => {
  it.each([
    ["uint256", "uint256"],
    ["address[]", "address"],
    ["Struct[][3]", "Struct"],
    ["bytes32[2][]", "bytes32"],
    ["string", "string"],
    ["Struct[003][]", "Struct"],
    ["Struct[x][]", "Struct[x]"],
    ["Struct[]x", "Struct[]x"],
    ["Struct[3", "Struct[3"],
    ["Struct[]\n", "Struct[]\n"],
    ["Struct[\u0663][]", "Struct[\u0663]"],
    ["[3][]", ""],
    ["", ""],
    ["A".repeat(126) + "[]", "A".repeat(126)],
    ["[".repeat(127) + "]", "[".repeat(126)],
  ])("preserves the suffix-stripping result for %j", (type, expected) => {
    expect(baseTypeName(type)).toBe(expected);
    expect(baseTypeName(type)).toBe(type.replace(/(\[\d*\])+$/, ""));
  });
});

describe.each([
  {
    name: "encodeType",
    encode: (types: unknown) => encodeType("Payload", types),
  },
  { name: "typeHash", encode: (types: unknown) => typeHash("Payload", types) },
  {
    name: "encodeField",
    encode: (types: unknown) => encodeField("uint8", 1, types),
  },
  {
    name: "hashStruct",
    encode: (types: unknown) => hashStruct("Payload", { value: 1 }, types),
  },
])("$name type-map boundary", ({ encode }) => {
  it.each([
    { label: "null", types: null },
    { label: "undefined", types: undefined },
    { label: "string", types: "Payload" },
    { label: "array", types: [] },
    {
      label: "array with a struct property",
      types: Object.assign([], {
        Payload: [{ name: "value", type: "uint8" }],
      }),
    },
  ])("rejects a $label type map", ({ types }) => {
    expect(() => encode(types)).toThrow(
      "typed data types must be a struct map",
    );
  });

  it.each([undefined, null, {}, [], "uint8"])(
    "rejects an invalid struct definition: %j",
    (definition) => {
      expect(() => encode({ Payload: definition })).toThrow(
        "empty or invalid struct: Payload",
      );
    },
  );

  it.each([
    { label: "null", field: null },
    { label: "undefined", field: undefined },
    { label: "primitive", field: 1 },
    { label: "missing name", field: { type: "uint8" } },
    { label: "numeric name", field: { name: 1, type: "uint8" } },
    { label: "empty name", field: { name: "", type: "uint8" } },
    {
      label: "array with field properties",
      field: Object.assign([], { name: "value", type: "uint8" }),
    },
  ])("rejects a field with $label", ({ field }) => {
    expect(() => encode({ Payload: [field] })).toThrow("bad field in Payload");
  });

  it.each([undefined, null, 1, ""])(
    "rejects an invalid field type: %j",
    (type) => {
      expect(() => encode({ Payload: [{ name: "value", type }] })).toThrow(
        "bad field type in Payload.value",
      );
    },
  );

  it("rejects a sparse struct definition", () => {
    expect(() => encode({ Payload: new Array<unknown>(1) })).toThrow(
      "bad field in Payload",
    );
  });
});

describe("typed data missing definitions and invalid field types", () => {
  it("requires the domain and primary type definitions", () => {
    const withoutDomain = payloadWith("uint8", 1);
    delete withoutDomain.types["QRLDomain"];
    expect(() => computeTypedDataDigest(withoutDomain)).toThrow(
      "QRLDomain type is required",
    );

    const withoutPrimary = payloadWith("uint8", 1);
    delete withoutPrimary.types["Payload"];
    expect(() => computeTypedDataDigest(withoutPrimary)).toThrow(
      "unknown primary type: Payload",
    );
  });

  it.each([
    ["Missing", "unknown type: Missing"],
    ["uint7", "invalid int width: uint7"],
    ["bytes0", "invalid bytesN width: bytes0"],
    ["uint8[0]", "invalid array size: uint8[0]"],
    ["uint8[257]", "invalid array size: uint8[257]"],
  ])("rejects %s", (type, error) => {
    expect(() => computeTypedDataDigest(payloadWith(type, 1))).toThrow(error);
  });
});

describe("typed data deterministic resource limits", () => {
  it("rejects a 1 MB field type in under 100 ms with a bounded error", () => {
    const fieldType = "[]".repeat(512 * 1024) + "x";
    const payload = payloadWith(fieldType, 1);
    const expectedError = new Error(
      `field type too long: ${fieldType.slice(0, 32)}... (length ${fieldType.length})`,
    );
    const started = performance.now();
    expect(() => computeTypedDataDigest(payload)).toThrow(expectedError);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("checks field type length before traversing dependencies or selecting a scheme", () => {
    const fieldType = "address" + "[]".repeat(64);
    const types = {
      Payload: [{ name: "value", type: "uint8" }],
      Unused: [{ name: "value", type: fieldType }],
    };
    expect(() => encodeType("Payload", types)).toThrow("field type too long");
    expect(() => encodeField("uint8", 1, types)).toThrow("field type too long");
    expect(() => hashStruct("Payload", { value: 1 }, types)).toThrow(
      "field type too long",
    );
    const payload = payloadWith("uint8", 1);
    payload.types["Unused"] = types.Unused;
    expect(() => typedDataSchemeVersion(payload)).toThrow(
      "field type too long",
    );
  });

  it("accepts field types at the length cap and rejects the next character", () => {
    const fieldType = `uint${"0".repeat(TYPED_DATA_LIMITS.maxFieldTypeLength - 5)}8`;
    expect(computeTypedDataDigest(payloadWith(fieldType, 1))).toHaveLength(64);
    expect(() =>
      computeTypedDataDigest(payloadWith(fieldType + "0", 1)),
    ).toThrow("field type too long");
    expect(() =>
      encodeField(fieldType + "0", 1, payloadWith("uint8", 1).types),
    ).toThrow("field type too long");
  });

  it.each(["struct", "field", "primary", "message", "domain"])(
    "bounds an oversized %s identifier in errors",
    (location) => {
      const input = "A".repeat(1024 * 1024);
      const payload = payloadWith("uint8", 1);
      let prefix = "";
      switch (location) {
        case "struct":
          payload.types[input] = [{ name: "value", type: "uint8" }];
          prefix = "invalid struct name";
          break;
        case "field":
          payload.types["Payload"] = [{ name: input, type: "uint8" }];
          prefix = "invalid field name in Payload";
          break;
        case "primary":
          payload.primaryType = input;
          prefix = "invalid primary type";
          break;
        case "message":
          payload.message[input] = 1;
          prefix = "unknown field in Payload";
          break;
        case "domain":
          payload.domain[input] = 1;
          prefix = "unknown field in QRLDomain";
          break;
      }
      expect(() => computeTypedDataDigest(payload)).toThrow(
        new Error(
          `${prefix}: ${input.slice(0, 32)}... (length ${input.length})`,
        ),
      );
    },
  );

  it("bounds address, integer and direct encoding errors", () => {
    const input = "A".repeat(1024 * 1024);
    const preview = `${input.slice(0, 32)}... (length ${input.length})`;
    const types = payloadWith("uint8", 1).types;
    expect(() => computeTypedDataDigest(payloadWith("address", input))).toThrow(
      new Error(`invalid Q-address: ${preview}`),
    );
    expect(() => encodeType(input, types)).toThrow(
      new Error(`unknown primary type: ${preview}`),
    );
    expect(() => hashStruct(input, {}, types)).toThrow(
      new Error(`unknown struct: ${preview}`),
    );
    expect(() => encodeField(input, 1, types)).toThrow(
      new Error(`field type too long: ${preview}`),
    );
    expect(() =>
      computeTypedDataDigest(payloadWith("uint8", "x".repeat(80))),
    ).toThrow(
      new Error(`invalid uint8 string: ${"x".repeat(32)}... (length 80)`),
    );
    expect(() =>
      computeTypedDataDigest(payloadWith("uint8", "9".repeat(80))),
    ).toThrow(
      new Error(`uint8 out of range: ${"9".repeat(32)}... (length 80)`),
    );
  });

  it("rejects unsigned top-level and type-definition display fields", () => {
    const topLevelExtra = {
      ...payloadWith("uint8", 1),
      displayName: "Approve harmless login",
    };
    expect(() => computeTypedDataDigest(topLevelExtra)).toThrow(
      /unknown top-level fields/,
    );

    const payload = payloadWith("uint8", 1);
    const field = payload.types["Payload"]?.find(
      (candidate) => candidate.name === "value",
    );
    if (!field) throw new Error("test fixture is missing Payload.value");
    Object.assign(field, { displayType: "string" });
    expect(() => computeTypedDataDigest(payload)).toThrow(/struct map/);
  });

  it.each(["string", "address", "bool", "bytes", "uint256", "int8", "bytes32"])(
    "rejects a struct that shadows the reserved atomic type %s",
    (reservedName) => {
      expect(() =>
        computeTypedDataDigest({
          types: {
            QRLDomain: [{ name: "name", type: "string" }],
            Payload: [{ name: "value", type: reservedName }],
            [reservedName]: [{ name: "hidden", type: "uint8" }],
          },
          primaryType: "Payload",
          domain: { name: "Security test" },
          message: { value: { hidden: 1 } },
        }),
      ).toThrow(/reserved by an atomic type/);
    },
  );

  it("rejects QRLDomain as the primary message type", () => {
    expect(() =>
      computeTypedDataDigest({
        types: { QRLDomain: [{ name: "name", type: "string" }] },
        primaryType: "QRLDomain",
        domain: { name: "Security test" },
        message: { name: "visually duplicated domain" },
      }),
    ).toThrow(/cannot be the primary type/);
  });

  it("rejects more than the maximum number of struct types", () => {
    const types: Record<string, Array<{ name: string; type: string }>> = {
      QRLDomain: [{ name: "name", type: "string" }],
      Payload: [{ name: "value", type: "uint8" }],
    };
    for (let index = 0; index < TYPED_DATA_LIMITS.maxTypes; index += 1) {
      types[`Unused${index}`] = [{ name: "value", type: "uint8" }];
    }
    expect(() =>
      computeTypedDataDigest({
        types,
        primaryType: "Payload",
        domain: { name: "Security test" },
        message: { value: 1 },
      }),
    ).toThrow(/struct map|struct types/);
  });

  it("rejects per-struct and aggregate field-count excesses", () => {
    const tooManyFields = new Array(TYPED_DATA_LIMITS.maxFieldsPerType + 1)
      .fill(null)
      .map((_, index) => ({ name: `field${index}`, type: "uint8" }));
    expect(() =>
      computeTypedDataDigest({
        types: {
          QRLDomain: [{ name: "name", type: "string" }],
          Payload: tooManyFields,
        },
        primaryType: "Payload",
        domain: { name: "Security test" },
        message: {},
      }),
    ).toThrow(/struct map|invalid struct/);

    const types: Record<string, Array<{ name: string; type: string }>> = {
      QRLDomain: [{ name: "name", type: "string" }],
      Payload: [{ name: "root", type: "Chunk0" }],
    };
    for (let typeIndex = 0; typeIndex < 8; typeIndex += 1) {
      types[`Chunk${typeIndex}`] = new Array(32)
        .fill(null)
        .map((_, fieldIndex) => ({
          name: `field${fieldIndex}`,
          type: "uint8",
        }));
    }
    expect(() =>
      computeTypedDataDigest({
        types,
        primaryType: "Payload",
        domain: { name: "Security test" },
        message: { root: {} },
      }),
    ).toThrow("too many fields");
  });

  it("rejects deep struct graphs and array type nesting", () => {
    const types: Record<string, Array<{ name: string; type: string }>> = {
      QRLDomain: [{ name: "name", type: "string" }],
    };
    let message: Record<string, unknown> = { value: 1 };
    for (
      let index = TYPED_DATA_LIMITS.maxTypeGraphDepth + 2;
      index >= 0;
      index -= 1
    ) {
      const next = `Node${index + 1}`;
      types[`Node${index}`] = [
        {
          name: "value",
          type:
            index > TYPED_DATA_LIMITS.maxTypeGraphDepth + 1 ? "uint8" : next,
        },
      ];
      if (index <= TYPED_DATA_LIMITS.maxTypeGraphDepth + 1)
        message = { value: message };
    }
    expect(() =>
      computeTypedDataDigest({
        types,
        primaryType: "Node0",
        domain: { name: "Security test" },
        message,
      }),
    ).toThrow("type graph nesting too deep");

    const nestedArrayType = `uint8${"[]".repeat(TYPED_DATA_LIMITS.maxArrayNesting + 1)}`;
    expect(() =>
      computeTypedDataDigest(payloadWith(nestedArrayType, [])),
    ).toThrow("type nesting too deep");
  });

  it("caps array length and total recursively encoded values", () => {
    expect(() =>
      computeTypedDataDigest(
        payloadWith(
          "uint8[]",
          new Array(TYPED_DATA_LIMITS.maxArrayLength + 1).fill(1),
        ),
      ),
    ).toThrow("exceeds length limit");

    const fields = new Array(8).fill(null).map((_, index) => ({
      name: `items${index}`,
      type: "uint8[]",
    }));
    const message = Object.fromEntries(
      fields.map((field) => [
        field.name,
        new Array(TYPED_DATA_LIMITS.maxArrayLength).fill(1),
      ]),
    );
    expect(() =>
      computeTypedDataDigest({
        types: {
          QRLDomain: [{ name: "name", type: "string" }],
          Payload: fields,
        },
        primaryType: "Payload",
        domain: { name: "Security test" },
        message,
      }),
    ).toThrow("too many encoded values");
  });

  it("caps dynamic byte values by encoded byte length", () => {
    expect(() =>
      computeTypedDataDigest(
        payloadWith(
          "bytes",
          `0x${"aa".repeat(TYPED_DATA_LIMITS.maxDynamicBytes + 1)}`,
        ),
      ),
    ).toThrow("bytes field exceeds typed data byte limit");
    expect(() =>
      computeTypedDataDigest(
        payloadWith(
          "string",
          "€".repeat(Math.ceil(TYPED_DATA_LIMITS.maxDynamicBytes / 3) + 1),
        ),
      ),
    ).toThrow("string field exceeds typed data byte limit");
  });

  it("encodes QIP-55 address fields under typed-data v2 and keeps Q+40 rejected", () => {
    const payload = payloadWith("address", SIGNER);
    expect(typedDataSchemeVersion(payload)).toBe("QRL-SIGN-TYPED-v2");
    expect(computeTypedDataDigest(payload)).toHaveLength(64);
    expect(() =>
      computeTypedDataDigest(payloadWith("address", LEGACY_Q40)),
    ).toThrow("invalid Q-address");
    // Address-free payloads keep v1.
    expect(typedDataSchemeVersion(payloadWith("uint8", 1))).toBe(
      "QRL-SIGN-TYPED-v1",
    );
  });

  it("rejects unsafe or unbounded identifiers", () => {
    expect(() =>
      computeTypedDataDigest({
        types: {
          QRLDomain: [{ name: "name", type: "string" }],
          Payload: [{ name: "constructor", type: "string" }],
        },
        primaryType: "Payload",
        domain: { name: "Security test" },
        message: { constructor: "hidden" },
      }),
    ).toThrow("invalid field name");
    expect(() =>
      computeTypedDataDigest({
        types: {
          QRLDomain: [{ name: "name", type: "string" }],
          ["A".repeat(TYPED_DATA_LIMITS.maxIdentifierLength + 1)]: [
            { name: "value", type: "uint8" },
          ],
        },
        primaryType: "A".repeat(TYPED_DATA_LIMITS.maxIdentifierLength + 1),
        domain: { name: "Security test" },
        message: { value: 1 },
      }),
    ).toThrow("invalid struct name");
  });

  it("still accepts bounded nested structs and arrays", () => {
    expect(() =>
      computeTypedDataDigest({
        types: {
          QRLDomain: [{ name: "name", type: "string" }],
          Payload: [{ name: "items", type: "Item[]" }],
          Item: [{ name: "value", type: "uint16" }],
        },
        primaryType: "Payload",
        domain: { name: "Security test" },
        message: { items: [{ value: 1 }, { value: 2 }] },
      }),
    ).not.toThrow();
  });
});
