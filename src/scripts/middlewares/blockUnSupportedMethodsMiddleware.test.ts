import { describe, expect, it, vi } from "vitest";
import { malformed } from "@/test-utils/malformed";
import { ALL_REQUEST_METHODS } from "../constants/requestConstants";
import { blockUnSupportedMethodsMiddleware } from "./blockUnSupportedMethodsMiddleware";

type Request = Parameters<typeof blockUnSupportedMethodsMiddleware>[0];
type Response = Parameters<typeof blockUnSupportedMethodsMiddleware>[1];

describe("supported method boundary", () => {
  it.each(ALL_REQUEST_METHODS)("passes %s to the next middleware", (method) => {
    const next = vi.fn();
    const end = vi.fn();
    blockUnSupportedMethodsMiddleware(
      { id: 1, jsonrpc: "2.0", method },
      { id: 1, jsonrpc: "2.0" },
      next,
      end,
    );
    expect(next).toHaveBeenCalledExactlyOnceWith();
    expect(end).not.toHaveBeenCalled();
  });

  it.each([
    { method: undefined, label: "undefined" },
    { method: null, label: "null" },
    { method: 17, label: "17" },
    { method: {}, label: "[object Object]" },
    { method: [], label: "" },
    { method: "", label: "" },
    { method: "unknown_method", label: "unknown_method" },
  ])("answers method-not-found for $label", ({ method, label }) => {
    const response: Response = { id: 1, jsonrpc: "2.0" };
    const next = vi.fn();
    const end = vi.fn();
    blockUnSupportedMethodsMiddleware(
      typeof method === "string"
        ? { id: 1, jsonrpc: "2.0", method }
        : malformed<Request>({ id: 1, jsonrpc: "2.0", method }),
      response,
      next,
      end,
    );
    expect(response.error).toMatchObject({
      code: -32601,
      message: `The method "${label}" does not exist / is not available.`,
    });
    expect(next).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledExactlyOnceWith();
  });
});
