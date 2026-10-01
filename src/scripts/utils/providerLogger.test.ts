import log from "loglevel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providerLogger } from "./providerLogger";

describe("providerLogger", () => {
  beforeEach(() => {
    vi.spyOn(log, "error").mockImplementation(() => undefined);
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    vi.spyOn(log, "debug").mockImplementation(() => undefined);
    vi.spyOn(log, "info").mockImplementation(() => undefined);
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

    expect(log.error).toHaveBeenCalledWith(
      "QrlWallet: something went wrong",
      "Internal JSON-RPC error (code -32603)",
    );
  });

  it("prints the message of a real Error", () => {
    providerLogger.warn("QrlWallet - RPC Error:", new Error("boom"));

    expect(log.warn).toHaveBeenCalledWith("QrlWallet - RPC Error:", "boom");
  });

  it("drops a transient network failure to debug", () => {
    providerLogger.error(
      "QrlWallet: Failed to get initial state. Please report this bug.",
      { code: -32603, message: "Failed to fetch" },
    );

    expect(log.error).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalled();
  });

  it("keeps a genuine error at error level", () => {
    providerLogger.error("QrlWallet: Received invalid network parameters.", {
      chainId: "nope",
    });

    expect(log.error).toHaveBeenCalled();
    expect(log.debug).not.toHaveBeenCalled();
  });

  it("passes plain values through untouched", () => {
    providerLogger.info("QrlWallet:", 42, null);

    expect(log.info).toHaveBeenCalledWith("QrlWallet:", 42, null);
  });
});
