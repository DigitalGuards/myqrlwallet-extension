import { vi } from "vitest";

const mockedBrowser = {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    session: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  tabs: {
    query: vi
      .fn()
      .mockResolvedValue([
        { url: "https://example.com", title: "Example", favIconUrl: "" },
      ]),
    create: vi.fn().mockResolvedValue({}),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onActivated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onUpdated: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
    connect: vi.fn(() => ({
      onDisconnect: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
    })),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onConnect: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  sidePanel: {
    setOptions: vi.fn().mockResolvedValue(undefined),
    setPanelBehavior: vi.fn().mockResolvedValue(undefined),
  },
  action: {
    onClicked: {
      addListener: vi.fn(),
    },
    openPopup: vi.fn().mockResolvedValue(undefined),
    setBadgeText: vi.fn().mockResolvedValue(undefined),
    setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
  },
  windows: {
    create: vi.fn().mockResolvedValue({ id: 77 }),
    update: vi.fn().mockResolvedValue({}),
    getLastFocused: vi
      .fn()
      .mockResolvedValue({ left: 0, top: 0, width: 1280, height: 800 }),
    onRemoved: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
};

export default mockedBrowser;
