// Exercise route defaults with each field malformed in isolation. Display
// fallbacks must preserve the transfer boundary's rejection of these inputs.
const nonStringValues: { label: string; value: unknown }[] = [
  { label: "number", value: 42 },
  { label: "zero number", value: 0 },
  { label: "fraction", value: 1.5 },
  { label: "NaN", value: NaN },
  { label: "infinity", value: Infinity },
  { label: "true", value: true },
  { label: "false", value: false },
  { label: "bigint", value: 42n },
  { label: "empty array", value: [] },
  { label: "string array", value: ["42"] },
  { label: "object", value: {} },
];

export const invalidNftTransferFields = [
  ...[
    "contractAddress",
    "tokenId",
    "collectionName",
    "imageUrl",
    "standard",
    "balance",
  ].flatMap((field) =>
    nonStringValues.map(({ label, value }) => ({
      label: `${field}: ${label}`,
      field,
      value,
    })),
  ),
  ...["contractAddress", "tokenId"].flatMap((field) =>
    [
      { label: "omitted", value: undefined },
      { label: "null", value: null },
      { label: "empty", value: "" },
      { label: "whitespace", value: " \t\n" },
    ].map(({ label, value }) => ({
      label: `${field}: ${label}`,
      field,
      value,
    })),
  ),
  ...["ZRC20", "zrc721", ""].map((value) => ({
    label: `standard: ${JSON.stringify(value)}`,
    field: "standard",
    value,
  })),
  { label: "balance: null", field: "balance", value: null },
  ...[
    "forty-two",
    "42.0",
    "1e2",
    "-1",
    "0x",
    "NaN",
    "Infinity",
    (1n << 256n).toString(),
    `0x${(1n << 256n).toString(16)}`,
  ].map((value) => ({
    label: `tokenId: ${value}`,
    field: "tokenId",
    value,
  })),
];

// Keep every previously supported integer spelling byte-for-byte in route
// state; the signer performs its existing BigInt conversion at the ABI call.
export const validNftTokenIds = [
  "0",
  "42",
  "0042",
  "+42",
  "-0",
  " 42\t",
  "0x2a",
  "0X2A",
  "0b101010",
  "0o52",
  ((1n << 256n) - 1n).toString(),
  `0x${"f".repeat(64)}`,
];
