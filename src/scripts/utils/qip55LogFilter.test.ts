import { describe, expect, it } from "vitest";
import { prepareQip55LogFilter, QIP55_LOG_TOPIC_ERROR } from "./qip55LogFilter";
import { toCanonicalQrlAddress } from "@/utilities/addressUtil";

const ADDRESS = `Q${"a".repeat(128)}`;

describe("QIP-55 log filter boundary", () => {
  it("canonicalizes address-only filters", () => {
    expect(
      prepareQip55LogFilter({
        address: `0x${"a".repeat(128)}`,
        fromBlock: "latest",
      }),
    ).toMatchObject({
      address: toCanonicalQrlAddress(ADDRESS),
      fromBlock: "latest",
    });
  });

  it("allows wildcard and exact VM64 topic positions", () => {
    const topic = `0x${"1".repeat(128)}`;
    expect(
      prepareQip55LogFilter({
        address: ADDRESS,
        topics: [null, topic, [topic]],
      }),
    ).toMatchObject({ topics: [null, topic, [topic]] });
  });

  it("preserves forwarded fields and canonicalizes every address without mutating the input", () => {
    const address = [`0x${"a".repeat(128)}`, `q${"b".repeat(128)}`];
    const topics = [null, `0x${"1".repeat(128)}`];
    const forwarded = {
      fromBlock: 1n,
      toBlock: "latest",
      blockHash: "0xblock",
      filter: { pending: true },
      futureField: { keep: true },
    };
    const input = { ...forwarded, address, topics };
    const result = prepareQip55LogFilter(input);

    expect(result).toEqual({
      ...forwarded,
      address: address.map(toCanonicalQrlAddress),
      topics,
    });
    expect(result).not.toBe(input);
    expect(result.topics).toBe(topics);
    expect(input.address).toEqual([
      `0x${"a".repeat(128)}`,
      `q${"b".repeat(128)}`,
    ]);
  });

  it("preserves absent and explicitly undefined optional fields", () => {
    expect(prepareQip55LogFilter({})).toEqual({});
    expect(
      prepareQip55LogFilter({ address: undefined, topics: undefined }),
    ).toStrictEqual({ address: undefined, topics: undefined });
  });

  it.each([null, undefined, [], "filter", 42])(
    "rejects a non-object filter (%j)",
    (filter) => {
      expect(() => prepareQip55LogFilter(filter)).toThrow(
        "QRL log filter must be an object",
      );
    },
  );

  it.each([null, 42, {}])("rejects non-string addresses (%j)", (address) => {
    expect(() => prepareQip55LogFilter({ address })).toThrow(
      "QRL address must be a string",
    );
    expect(() =>
      prepareQip55LogFilter({ address: [ADDRESS, address] }),
    ).toThrow("QRL address must be a string");
  });

  it.each([
    { topics: [`0x${"1".repeat(64)}`] },
    { topics: [null, [`0x${"2".repeat(64)}`]] },
    { topics: [`0X${"2".repeat(128)}`] },
    { topics: "not-an-array" },
  ])("fails closed for ambiguous or malformed topics", ({ topics }) => {
    expect(() => prepareQip55LogFilter({ address: ADDRESS, topics })).toThrow(
      QIP55_LOG_TOPIC_ERROR,
    );
  });

  it("rejects legacy-width filter addresses", () => {
    expect(() =>
      prepareQip55LogFilter({ address: `Q${"a".repeat(40)}` }),
    ).toThrow(/128 hexadecimal characters/);
  });
});
