import { describe, expect, it } from "vitest";
import { prepareQip55LogFilter, QIP55_LOG_TOPIC_ERROR } from "./qip55LogFilter";

const ADDRESS = `Q${"a".repeat(128)}`;

describe("QIP-55 log filter boundary", () => {
  it("canonicalizes address-only filters", () => {
    expect(
      prepareQip55LogFilter({
        address: `0x${"a".repeat(128)}`,
        fromBlock: "latest",
      }),
    ).toMatchObject({
      address: expect.stringMatching(/^Q[0-9a-fA-F]{128}$/),
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
