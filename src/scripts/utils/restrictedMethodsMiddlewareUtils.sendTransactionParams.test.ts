// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  checkTransactionCallData,
  checkTransactionTypeIsSupported,
  sendTransactionParamsForApproval,
} from "./restrictedMethodsMiddlewareUtils";

const CALL = `0xa9059cbb${"00".repeat(31)}ff`;
const INVALID_PARAMS = -32602;

describe("sendTransactionParamsForApproval", () => {
  it("moves call data that came as input to data, at params[0] of an array", () => {
    expect(
      sendTransactionParamsForApproval([{ to: "Q01", input: CALL }, "latest"]),
    ).toEqual([{ to: "Q01", data: CALL }, "latest"]);
  });

  it('does the same under "0" of indexed params, and keeps the other keys', () => {
    expect(
      sendTransactionParamsForApproval({ 0: { input: CALL }, 1: "latest" }),
    ).toEqual({ 0: { data: CALL }, 1: "latest" });
  });

  it("does not change the params it was given", () => {
    const transaction = { to: "Q01", input: CALL };
    const params = [transaction];
    sendTransactionParamsForApproval(params);
    expect(params).toEqual([{ to: "Q01", input: CALL }]);
    expect(params[0]).toBe(transaction);
  });

  it.each([
    ["an empty list", []],
    ["a transaction without input", [{ to: "Q01", data: CALL }]],
    ["data and input that differ", [{ data: "0x01", input: CALL }]],
    ["an input that is no text", [{ input: 1 }]],
    ["a transaction that is no object", ["0x"]],
    ["indexed params without a transaction", { 1: { input: CALL } }],
    ["no params", undefined],
    ["params that are text", "0x"],
  ])("leaves %s as they are", (_label, params) => {
    expect(sendTransactionParamsForApproval(params)).toEqual(params);
  });
});

describe("checkTransactionTypeIsSupported", () => {
  it.each([
    [[{}]],
    [[{ type: null }]],
    [[{ type: "0x2" }]],
    [[{ type: 2 }]],
    [{ 0: { type: "0x02" } }],
  ])("lets %j proceed", (params) => {
    expect(checkTransactionTypeIsSupported(params)).toEqual({
      canProceed: true,
      proceedError: undefined,
    });
  });

  it.each([
    [[{ type: "0x0" }], '"0x0"'],
    [[{ type: 1 }], "1"],
    [{ 0: { type: "0x1" } }, '"0x1"'],
  ])("refuses %j with invalid params", (params, named) => {
    const result = checkTransactionTypeIsSupported(params);
    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.code).toBe(INVALID_PARAMS);
    expect(result.proceedError?.message).toBe(
      `QRL transactions are of type 0x2. Received type: ${named}`,
    );
  });

  // A request without a readable transaction is refused by the approval
  // itself; there is no type here to judge.
  it.each([[undefined], [[]], [["0x"]]])(
    "has nothing to refuse in %j",
    (params) => {
      expect(checkTransactionTypeIsSupported(params).canProceed).toBe(true);
    },
  );
});

describe("checkTransactionCallData", () => {
  it.each([
    [[{ data: CALL }]],
    [[{ input: CALL }]],
    [[{ data: CALL, input: CALL }]],
    [[{}]],
    [undefined],
  ])("lets %j proceed", (params) => {
    expect(checkTransactionCallData(params)).toEqual({
      canProceed: true,
      proceedError: undefined,
    });
  });

  it.each([
    [
      [{ data: "0x01", input: CALL }],
      '"data" and "input" are both set and differ',
    ],
    [{ 0: { input: 1 } }, '"input" has to be a hex string'],
  ])("refuses %j with invalid params", (params, message) => {
    const result = checkTransactionCallData(params);
    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.code).toBe(INVALID_PARAMS);
    expect(result.proceedError?.message).toBe(message);
  });
});
