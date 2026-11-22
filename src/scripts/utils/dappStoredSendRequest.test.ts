// @vitest-environment node
import { describe, expect, it } from "vitest";
import { storedSendRequestProblem } from "./dappStoredSendRequest";

describe("storedSendRequestProblem", () => {
  it.each([
    ["a transfer of type 0x2", { to: "Q01", value: "0x1", type: "0x2" }],
    ["a call with its call data as data", { to: "Q01", data: "0xa9059cbb" }],
    ["a request without a type", { to: "Q01", value: "0x1" }],
    ["a null type and a null input", { to: "Q01", type: null, input: null }],
    ["no transaction", undefined],
    ["a transaction that is no object", "0x"],
  ])("finds nothing wrong with %s", (_label, transaction) => {
    expect(storedSendRequestProblem(transaction)).toBeUndefined();
  });

  it.each([
    ["an input beside nothing", { to: "Q01", input: "0xa9059cbb" }],
    ["an input equal to its data", { data: "0x01", input: "0x01" }],
    ["an input that is no text", { input: 1 }],
  ])(
    "names %s as call data the approval does not read",
    (_label, transaction) => {
      expect(storedSendRequestProblem(transaction)).toBe(
        'The request names call data as "input", which the approval does not read',
      );
    },
  );

  it.each([
    ["0x0", '"0x0"'],
    [1, "1"],
    [2n, "2n"],
  ])("names the type %s", (type, named) => {
    expect(storedSendRequestProblem({ to: "Q01", type })).toBe(
      `QRL transactions are of type 0x2. Received type: ${named}`,
    );
  });

  it("names the call data first when both are wrong", () => {
    expect(storedSendRequestProblem({ type: "0x0", input: "0x01" })).toBe(
      'The request names call data as "input", which the approval does not read',
    );
  });
});
