import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LEDGER_CONFIG, LEDGER_ERROR_MESSAGES } from "@/constants/ledger";
import Transport from "@ledgerhq/hw-transport";
import type TransportWebHID from "@ledgerhq/hw-transport-webhid";
import { LedgerTransportService } from "./ledgerTransport";
import { SpeculosTransportService } from "./speculosTransport";

const mockOn = vi.fn<(event: string, callback: () => void) => void>();
const mockClose = vi.fn<Transport["close"]>();
const mockSend = vi.fn<Transport["send"]>();
const mockExchange = vi.fn<Transport["exchange"]>();

const mockTransportInstance = Object.assign(new Transport(), {
  on: mockOn,
  close: mockClose,
  send: mockSend,
  exchange: mockExchange,
});

const mockCreate = vi.hoisted(() => vi.fn<typeof TransportWebHID.create>());

vi.mock("@ledgerhq/hw-transport-webhid", () => ({
  default: { create: mockCreate },
}));

function simulateDisconnect(): void {
  const disconnectHandler = mockOn.mock.calls.find(
    ([event]) => event === "disconnect",
  )?.[1];
  if (!disconnectHandler) {
    throw new Error("Disconnect handler was not registered");
  }
  disconnectHandler();
}

describe("LedgerTransportService", () => {
  let service: LedgerTransportService;
  let originalNavigator: PropertyDescriptor | undefined;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    mockCreate.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockOn.mockReset();
    mockClose.mockReset().mockResolvedValue(undefined);
    mockSend.mockReset();
    mockExchange.mockReset();

    // Create fresh service instance
    service = new LedgerTransportService();

    // Store original navigator descriptor
    originalNavigator = Object.getOwnPropertyDescriptor(global, "navigator");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore navigator
    if (originalNavigator) {
      Object.defineProperty(global, "navigator", originalNavigator);
    }
  });

  describe("isSupported", () => {
    it("should return true when navigator.hid is available", () => {
      Object.defineProperty(global, "navigator", {
        value: { hid: {} },
        writable: true,
        configurable: true,
      });

      expect(service.isSupported()).toBe(true);
    });

    it("should return false when navigator.hid is not available", () => {
      Object.defineProperty(global, "navigator", {
        value: {},
        writable: true,
        configurable: true,
      });

      expect(service.isSupported()).toBe(false);
    });

    it("should return false when navigator is undefined", () => {
      Object.defineProperty(global, "navigator", {
        value: undefined,
        writable: true,
        configurable: true,
      });

      expect(service.isSupported()).toBe(false);
    });
  });

  describe("connect", () => {
    beforeEach(() => {
      // Enable WebHID support for connect tests
      Object.defineProperty(global, "navigator", {
        value: { hid: {} },
        writable: true,
        configurable: true,
      });
    });

    it("should create transport and return it on success", async () => {
      mockCreate.mockResolvedValue(mockTransportInstance);

      const transport = await service.connect();

      expect(mockCreate).toHaveBeenCalledWith(LEDGER_CONFIG.CONNECTION_TIMEOUT);
      expect(transport).toBe(mockTransportInstance);
      expect(mockOn).toHaveBeenCalledWith("disconnect", expect.any(Function));
    });

    it("should return existing transport if already connected", async () => {
      mockCreate.mockResolvedValue(mockTransportInstance);

      // First connection
      const transport1 = await service.connect();
      // Second connection should return same instance
      const transport2 = await service.connect();

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(transport1).toBe(transport2);
    });

    it("should throw WEBHID_NOT_SUPPORTED when WebHID is not available", async () => {
      Object.defineProperty(global, "navigator", {
        value: {},
        writable: true,
        configurable: true,
      });

      await expect(service.connect()).rejects.toThrow(
        LEDGER_ERROR_MESSAGES.WEBHID_NOT_SUPPORTED,
      );
    });

    it("should throw DEVICE_NOT_FOUND when user closes dialog", async () => {
      mockCreate.mockRejectedValue(new Error("No device selected"));

      await expect(service.connect()).rejects.toThrow(
        LEDGER_ERROR_MESSAGES.DEVICE_NOT_FOUND,
      );
    });

    it("should throw CONNECTION_FAILED when access is denied", async () => {
      mockCreate.mockRejectedValue(new Error("Access denied to device"));

      await expect(service.connect()).rejects.toThrow(
        LEDGER_ERROR_MESSAGES.CONNECTION_FAILED,
      );
    });

    it("should throw CONNECTION_FAILED for other errors", async () => {
      mockCreate.mockRejectedValue(new Error("Unknown error"));

      await expect(service.connect()).rejects.toThrow(
        LEDGER_ERROR_MESSAGES.CONNECTION_FAILED,
      );
    });

    it("should register disconnect handler", async () => {
      mockCreate.mockResolvedValue(mockTransportInstance);

      await service.connect();

      expect(mockOn).toHaveBeenCalledWith("disconnect", expect.any(Function));
    });

    it("should call onDisconnect callback when device disconnects", async () => {
      mockCreate.mockResolvedValue(mockTransportInstance);
      const onDisconnect = vi.fn();

      service.onDisconnect(onDisconnect);
      await service.connect();

      // Get the disconnect handler and call it
      simulateDisconnect();

      expect(onDisconnect).toHaveBeenCalled();
      expect(service.isConnected()).toBe(false);
    });

    it("should clear transport when device disconnects", async () => {
      mockCreate.mockResolvedValue(mockTransportInstance);

      await service.connect();
      expect(service.isConnected()).toBe(true);

      // Simulate disconnect
      simulateDisconnect();

      expect(service.isConnected()).toBe(false);
    });
  });

  describe("disconnect", () => {
    beforeEach(() => {
      Object.defineProperty(global, "navigator", {
        value: { hid: {} },
        writable: true,
        configurable: true,
      });
    });

    it("should close transport and clear state", async () => {
      mockCreate.mockResolvedValue(mockTransportInstance);
      mockClose.mockResolvedValue(undefined);

      await service.connect();
      expect(service.isConnected()).toBe(true);

      await service.disconnect();

      expect(mockClose).toHaveBeenCalled();
      expect(service.isConnected()).toBe(false);
    });

    it("should do nothing if not connected", async () => {
      await service.disconnect();

      expect(mockClose).not.toHaveBeenCalled();
    });

    it("should clear state even if close throws error", async () => {
      mockCreate.mockResolvedValue(mockTransportInstance);
      mockClose.mockRejectedValue(new Error("Close error"));

      await service.connect();
      await service.disconnect();

      expect(service.isConnected()).toBe(false);
    });
  });

  describe("isConnected", () => {
    beforeEach(() => {
      Object.defineProperty(global, "navigator", {
        value: { hid: {} },
        writable: true,
        configurable: true,
      });
    });

    it("should return false when not connected", () => {
      expect(service.isConnected()).toBe(false);
    });

    it("should return true when connected", async () => {
      mockCreate.mockResolvedValue(mockTransportInstance);

      await service.connect();

      expect(service.isConnected()).toBe(true);
    });

    it("should return false after disconnect", async () => {
      mockCreate.mockResolvedValue(mockTransportInstance);
      mockClose.mockResolvedValue(undefined);

      await service.connect();
      await service.disconnect();

      expect(service.isConnected()).toBe(false);
    });
  });

  describe("onDisconnect", () => {
    it("should register callback", () => {
      const callback = vi.fn();

      service.onDisconnect(callback);

      // Callback is stored, will be called on disconnect
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("send", () => {
    beforeEach(() => {
      Object.defineProperty(global, "navigator", {
        value: { hid: {} },
        writable: true,
        configurable: true,
      });
    });

    it("should send APDU command and return response", async () => {
      const mockResponse = Buffer.from([0x01, 0x02, 0x90, 0x00]);
      mockCreate.mockResolvedValue(mockTransportInstance);
      mockSend.mockResolvedValue(mockResponse);

      const response = await service.send(0xe0, 0x03, 0x00, 0x00);

      expect(mockSend).toHaveBeenCalledWith(0xe0, 0x03, 0x00, 0x00, undefined);
      expect(response).toEqual(mockResponse);
    });

    it("should send APDU command with data", async () => {
      const mockResponse = Buffer.from([0x90, 0x00]);
      const inputData = Buffer.from([0xaa, 0xbb, 0xcc]);
      mockCreate.mockResolvedValue(mockTransportInstance);
      mockSend.mockResolvedValue(mockResponse);

      await service.send(0xe0, 0x05, 0x00, 0x00, inputData);

      expect(mockSend).toHaveBeenCalledWith(0xe0, 0x05, 0x00, 0x00, inputData);
    });

    it("should auto-connect if not connected", async () => {
      const mockResponse = Buffer.from([0x90, 0x00]);
      mockCreate.mockResolvedValue(mockTransportInstance);
      mockSend.mockResolvedValue(mockResponse);

      expect(service.isConnected()).toBe(false);

      await service.send(0xe0, 0x03, 0x00, 0x00);

      expect(mockCreate).toHaveBeenCalled();
      expect(service.isConnected()).toBe(true);
    });

    it("should throw DEVICE_DISCONNECTED when device was unplugged", async () => {
      mockCreate.mockResolvedValue(mockTransportInstance);
      mockSend.mockRejectedValue(new Error("Device was disconnected"));

      await expect(service.send(0xe0, 0x03, 0x00, 0x00)).rejects.toThrow(
        LEDGER_ERROR_MESSAGES.DEVICE_DISCONNECTED,
      );
      expect(service.isConnected()).toBe(false);
    });

    it("should pass through other errors", async () => {
      mockCreate.mockResolvedValue(mockTransportInstance);
      mockSend.mockRejectedValue(new Error("Some APDU error"));

      await expect(service.send(0xe0, 0x03, 0x00, 0x00)).rejects.toThrow(
        "Some APDU error",
      );
    });

    it("should pass through non-Error rejections", async () => {
      mockCreate.mockResolvedValue(mockTransportInstance);
      mockSend.mockRejectedValue({ statusCode: 0x6985 });

      await expect(service.send(0xe0, 0x03, 0x00, 0x00)).rejects.toEqual({
        statusCode: 0x6985,
      });
    });
  });

  describe("exchange", () => {
    beforeEach(() => {
      Object.defineProperty(global, "navigator", {
        value: { hid: {} },
        writable: true,
        configurable: true,
      });
    });

    it("should exchange raw APDU data", async () => {
      const mockResponse = Buffer.from([0x01, 0x02, 0x90, 0x00]);
      const apduData = Buffer.from([0xe0, 0x03, 0x00, 0x00, 0x00]);
      mockCreate.mockResolvedValue(mockTransportInstance);
      mockExchange.mockResolvedValue(mockResponse);

      const response = await service.exchange(apduData);

      expect(mockExchange).toHaveBeenCalledWith(apduData);
      expect(response).toEqual(mockResponse);
    });

    it("should auto-connect if not connected", async () => {
      const mockResponse = Buffer.from([0x90, 0x00]);
      mockCreate.mockResolvedValue(mockTransportInstance);
      mockExchange.mockResolvedValue(mockResponse);

      expect(service.isConnected()).toBe(false);

      await service.exchange(Buffer.from([0xe0, 0x03, 0x00, 0x00, 0x00]));

      expect(mockCreate).toHaveBeenCalled();
    });
  });
});

// Test singleton export
describe("ledgerTransport singleton", () => {
  it("should export a singleton instance", async () => {
    const { ledgerTransport } = await import("./ledgerTransport");

    expect(ledgerTransport).toBeDefined();
    expect(typeof ledgerTransport.connect).toBe("function");
    expect(typeof ledgerTransport.disconnect).toBe("function");
    expect(typeof ledgerTransport.send).toBe("function");
    expect(typeof ledgerTransport.isSupported).toBe("function");
    expect(typeof ledgerTransport.isConnected).toBe("function");
  });
});

describe("SpeculosTransportService", () => {
  const mockFetch = vi.fn<typeof fetch>();
  const mockError = vi.fn<(message: string, error: unknown) => void>();
  let service: SpeculosTransportService;

  beforeEach(() => {
    mockFetch.mockReset();
    mockError.mockReset();
    vi.stubGlobal("fetch", mockFetch);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(mockError);
    service = new SpeculosTransportService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function connectSpeculos(): Promise<void> {
    mockFetch.mockResolvedValueOnce(new Response());
    await service.connect();
    mockFetch.mockClear();
  }

  it("clears connection state immediately and resolves disconnect", async () => {
    await connectSpeculos();
    const onDisconnect = vi.fn<() => void>();
    service.onDisconnect(onDisconnect);
    expect(service.isConnected()).toBe(true);

    const disconnected = service.disconnect();

    expect(service.isConnected()).toBe(false);
    expect(disconnected).toBeInstanceOf(Promise);
    await expect(disconnected).resolves.toBeUndefined();
    expect(onDisconnect).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    { data: undefined, hex: "e005010200" },
    { data: new Uint8Array(), hex: "e005010200" },
    { data: new Uint8Array([0xaa, 0xbb, 0xcc]), hex: "e005010203aabbcc" },
  ])("preserves APDU request bytes for $hex", async ({ data, hex }) => {
    await connectSpeculos();
    mockFetch.mockResolvedValueOnce(Response.json({ data: "0123aB9000" }));

    const response = await service.send(0xe0, 0x05, 0x01, 0x02, data);

    expect(mockFetch).toHaveBeenCalledExactlyOnceWith(
      "http://localhost:5000/apdu",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: hex }),
      },
    );
    expect(response).toEqual(new Uint8Array([0x01, 0x23, 0xab, 0x90, 0x00]));
    expect(service.isConnected()).toBe(true);
  });

  it.each([
    { hex: "", bytes: [] },
    { hex: "0x", bytes: [] },
    { hex: "9000", bytes: [0x90, 0x00] },
    { hex: "0x9000", bytes: [0x90, 0x00] },
    { hex: "0xAbcD9000", bytes: [0xab, 0xcd, 0x90, 0x00] },
  ])("decodes valid response hex '$hex'", async ({ hex, bytes }) => {
    await connectSpeculos();
    mockFetch.mockResolvedValueOnce(Response.json({ data: hex }));

    await expect(service.send(0xe0, 0x03, 0, 0)).resolves.toEqual(
      new Uint8Array(bytes),
    );
    expect(mockError).not.toHaveBeenCalled();
  });

  it.each([
    { label: "null envelope", body: null },
    { label: "array envelope", body: [] },
    { label: "primitive envelope", body: "9000" },
    { label: "missing data", body: {} },
    { label: "null data", body: { data: null } },
    { label: "numeric data", body: { data: 9000 } },
    { label: "array data", body: { data: [0x90, 0x00] } },
    { label: "object data", body: { data: {} } },
    { label: "odd hex length", body: { data: "900" } },
    { label: "odd prefixed hex length", body: { data: "0x900" } },
    { label: "invalid hex byte", body: { data: "90gg" } },
    { label: "partially valid hex byte", body: { data: "9g00" } },
    { label: "whitespace", body: { data: " 9000" } },
  ])("rejects malformed APDU responses: $label", async ({ body }) => {
    await connectSpeculos();
    mockFetch.mockResolvedValueOnce(Response.json(body));
    const onDisconnect = vi.fn<() => void>();
    service.onDisconnect(onDisconnect);

    await expect(service.send(0xe0, 0x03, 0, 0)).rejects.toThrow(
      "Invalid Speculos APDU response",
    );
    expect(mockError).toHaveBeenCalledExactlyOnceWith(
      "[SpeculosTransport] Send failed:",
      new Error("Invalid Speculos APDU response"),
    );
    expect(service.isConnected()).toBe(true);
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("preserves APDU JSON parse errors", async () => {
    await connectSpeculos();
    mockFetch.mockResolvedValueOnce(new Response("{"));

    await expect(service.send(0xe0, 0x03, 0, 0)).rejects.toBeInstanceOf(
      SyntaxError,
    );
    expect(mockError).toHaveBeenCalledExactlyOnceWith(
      "[SpeculosTransport] Send failed:",
      expect.any(SyntaxError),
    );
    expect(service.isConnected()).toBe(true);
  });

  it("preserves APDU HTTP status errors", async () => {
    await connectSpeculos();
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(service.send(0xe0, 0x03, 0, 0)).rejects.toThrow(
      "Speculos API error: 503",
    );
    expect(service.isConnected()).toBe(true);
  });

  it("clears connection state before notifying a fetch disconnect", async () => {
    await connectSpeculos();
    const onDisconnect = vi.fn(() => {
      expect(service.isConnected()).toBe(false);
    });
    service.onDisconnect(onDisconnect);
    const error = new TypeError("Failed to fetch");
    mockFetch.mockRejectedValueOnce(error);

    await expect(service.send(0xe0, 0x03, 0, 0)).rejects.toThrow(
      LEDGER_ERROR_MESSAGES.DEVICE_DISCONNECTED,
    );
    expect(onDisconnect).toHaveBeenCalledExactlyOnceWith();
    expect(mockError).toHaveBeenCalledExactlyOnceWith(
      "[SpeculosTransport] Send failed:",
      error,
    );
  });

  it("requires a connection before sending an APDU", async () => {
    await expect(service.send(0xe0, 0x03, 0, 0)).rejects.toThrow(
      LEDGER_ERROR_MESSAGES.NOT_CONNECTED,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("preserves screen text order and duplicates while skipping absent text", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        events: [
          { text: "Review", x: 10, y: 20 },
          { text: "" },
          {},
          { text: null },
          { text: "Amount" },
          { text: "Review" },
          { text: " " },
        ],
      }),
    );

    await expect(service.getScreenText()).resolves.toEqual([
      "Review",
      "Amount",
      "Review",
      " ",
    ]);
    expect(mockFetch).toHaveBeenCalledExactlyOnceWith(
      "http://localhost:5000/events?stream=false",
    );
    expect(mockError).not.toHaveBeenCalled();
  });

  it.each([
    { label: "missing events", body: {} },
    { label: "null events", body: { events: null } },
    { label: "empty events", body: { events: [] } },
  ])("preserves empty screen text for $label", async ({ body }) => {
    mockFetch.mockResolvedValueOnce(Response.json(body));

    await expect(service.getScreenText()).resolves.toEqual([]);
    expect(mockError).not.toHaveBeenCalled();
  });

  it.each([
    { label: "null envelope", body: null },
    { label: "array envelope", body: [] },
    { label: "primitive envelope", body: "events" },
    { label: "object events", body: { events: {} } },
    { label: "string events", body: { events: "Review" } },
    { label: "null event", body: { events: [{ text: "Review" }, null] } },
    { label: "array event", body: { events: [{ text: "Review" }, []] } },
    { label: "primitive event", body: { events: [{ text: "Review" }, 42] } },
    {
      label: "numeric text",
      body: { events: [{ text: "Review" }, { text: 42 }] },
    },
    {
      label: "boolean text",
      body: { events: [{ text: "Review" }, { text: false }] },
    },
    {
      label: "object text",
      body: { events: [{ text: "Review" }, { text: {} }] },
    },
    {
      label: "array text",
      body: { events: [{ text: "Review" }, { text: ["Amount"] }] },
    },
  ])("fails closed for malformed screen events: $label", async ({ body }) => {
    mockFetch.mockResolvedValueOnce(Response.json(body));

    await expect(service.getScreenText()).resolves.toEqual([]);
    expect(mockError).toHaveBeenCalledExactlyOnceWith(
      "[SpeculosTransport] Failed to get screen text:",
      new Error("Invalid Speculos events response"),
    );
  });

  it("preserves the empty screen fallback for JSON parse errors", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{"));

    await expect(service.getScreenText()).resolves.toEqual([]);
    expect(mockError).toHaveBeenCalledExactlyOnceWith(
      "[SpeculosTransport] Failed to get screen text:",
      expect.any(SyntaxError),
    );
  });

  it("preserves the empty screen fallback for network failures", async () => {
    const error = new TypeError("Failed to fetch");
    mockFetch.mockRejectedValueOnce(error);

    await expect(service.getScreenText()).resolves.toEqual([]);
    expect(mockError).toHaveBeenCalledExactlyOnceWith(
      "[SpeculosTransport] Failed to get screen text:",
      error,
    );
  });
});
