import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSendMessage, mockConnect } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
  mockConnect: vi.fn(),
}));

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    runtime: {
      sendMessage: mockSendMessage,
      connect: mockConnect,
      lastError: undefined,
    },
  },
}));

import { QRL_POST_MESSAGE_STREAM } from "../constants/streamConstants";
import {
  CONTENT_SCRIPT_KEEP_ALIVE_INTERVAL_MS,
  startContentScriptKeepAlive,
} from "./contentScriptKeepAlive";

describe("startContentScriptKeepAlive", () => {
  let interval: ReturnType<typeof setInterval> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSendMessage.mockReset().mockResolvedValue(undefined);
    mockConnect.mockReset();
  });

  afterEach(() => {
    clearInterval(interval);
    vi.useRealTimers();
  });

  it("sends one keep-alive message per interval and opens no ports", async () => {
    interval = startContentScriptKeepAlive();

    await vi.advanceTimersByTimeAsync(
      CONTENT_SCRIPT_KEEP_ALIVE_INTERVAL_MS * 10,
    );

    expect(mockSendMessage).toHaveBeenCalledTimes(10);
    expect(mockSendMessage).toHaveBeenCalledWith({
      name: QRL_POST_MESSAGE_STREAM.CONTENT_SCRIPT_KEEP_ALIVE,
    });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("swallows a rejected message and keeps ticking", async () => {
    mockSendMessage.mockRejectedValue(
      new Error(
        "Could not establish connection. Receiving end does not exist.",
      ),
    );
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    interval = startContentScriptKeepAlive();

    await vi.advanceTimersByTimeAsync(
      CONTENT_SCRIPT_KEEP_ALIVE_INTERVAL_MS * 3,
    );

    expect(mockSendMessage).toHaveBeenCalledTimes(3);
    await Promise.resolve();
    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });
});
