import { vi } from "vitest";
import type { Runtime } from "webextension-polyfill";

export type RuntimeMessageListener = (
  message: unknown,
  sender?: Runtime.MessageSender,
) => unknown;

const createEvent = <T extends (...args: never[]) => void>() => ({
  addListener: vi.fn<(listener: T) => void>(),
  removeListener: vi.fn<(listener: T) => void>(),
  hasListener: vi.fn<(listener: T) => boolean>().mockReturnValue(false),
  hasListeners: vi.fn<() => boolean>().mockReturnValue(false),
});

export const createPort = (name: string, sender?: Runtime.MessageSender) => {
  const metadata: Pick<Runtime.Port, "sender" | "error"> = { sender };
  return {
    ...metadata,
    name,
    onMessage: createEvent<(message: unknown, port: Runtime.Port) => void>(),
    onDisconnect: createEvent<(port: Runtime.Port) => void>(),
    disconnect: vi.fn<() => void>(),
    postMessage: vi.fn<(message: unknown) => void>(),
  } satisfies Runtime.Port;
};
