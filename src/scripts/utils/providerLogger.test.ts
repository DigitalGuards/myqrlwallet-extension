import log from "loglevel";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { providerLogger } from "./providerLogger";

let mockedLog: {
  [Level in "error" | "warn" | "debug" | "info"]: MockInstance<
    (typeof log)[Level]
  >;
};

describe("providerLogger", () => {
  beforeEach(() => {
    mockedLog = {
      error: vi.spyOn(log, "error").mockImplementation(() => undefined),
      warn: vi.spyOn(log, "warn").mockImplementation(() => undefined),
      debug: vi.spyOn(log, "debug").mockImplementation(() => undefined),
      info: vi.spyOn(log, "info").mockImplementation(() => undefined),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the message of an error that crossed the stream", () => {
    // What arrives is a serialized plain object, which a page that wraps
    // console renders as "[object Object]".
    providerLogger.error("QrlWallet: something went wrong", {
      code: -32603,
      message: "Internal JSON-RPC error",
      stack: "...",
    });

    expect(mockedLog.error).toHaveBeenCalledWith(
      "QrlWallet: something went wrong",
      "Internal JSON-RPC error (code -32603)",
    );
  });

  it("prints the message of a real Error", () => {
    providerLogger.warn("QrlWallet - RPC Error:", new Error("boom"));

    expect(mockedLog.warn).toHaveBeenCalledWith(
      "QrlWallet - RPC Error:",
      "boom",
    );
  });

  it("drops a transient network failure to debug", () => {
    providerLogger.error(
      "QrlWallet: Failed to get initial state. Please report this bug.",
      { code: -32603, message: "Failed to fetch" },
    );

    expect(mockedLog.error).not.toHaveBeenCalled();
    expect(mockedLog.debug).toHaveBeenCalled();
  });

  it("keeps a genuine error at error level", () => {
    providerLogger.error("QrlWallet: Received invalid network parameters.", {
      chainId: "nope",
    });

    expect(mockedLog.error).toHaveBeenCalled();
    expect(mockedLog.debug).not.toHaveBeenCalled();
  });

  it("passes plain values through untouched", () => {
    providerLogger.info("QrlWallet:", 42, null);

    expect(mockedLog.info).toHaveBeenCalledWith("QrlWallet:", 42, null);
  });

  it("narrows serialized messages and codes while preserving other objects", () => {
    const malformed = { message: 42, code: -1 };
    const details = { message: "rejected", code: { reason: "permission" } };

    providerLogger.info(malformed, details, { message: "failed", code: "RPC" });

    expect(mockedLog.info).toHaveBeenCalledWith(
      malformed,
      "rejected",
      "failed (code RPC)",
    );
  });

  it("keeps the page-reload notice visible", () => {
    // A bare /disconnected/ pattern hid this one, and it is exactly the
    // line a dApp developer needs when the stream really has gone.
    providerLogger.error(
      "QrlWallet: Disconnected from MyQRLWallet background. Page reload required.",
    );

    expect(mockedLog.error).toHaveBeenCalled();
    expect(mockedLog.debug).not.toHaveBeenCalled();
  });
});
