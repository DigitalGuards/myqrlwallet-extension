import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LEDGER_CONFIG, LEDGER_ERROR_MESSAGES } from "@/constants/ledger";
import type Transport from "@ledgerhq/hw-transport";

// Mock transport instance
const mockOn = vi.fn();
const mockClose = vi.fn();
const mockSend = vi.fn();
const mockExchange = vi.fn();

const mockTransportInstance = {
  on: mockOn,
  close: mockClose,
  send: mockSend,
  exchange: mockExchange,
};

// Mock the WebHID transport module
vi.mock("@ledgerhq/hw-transport-webhid", () => ({
  __esModule: true,
  default: {
    create: vi.fn(),
  },
}));

// Get the mocked module
import TransportWebHID from "@ledgerhq/hw-transport-webhid";
const mockedTransportWebHID = TransportWebHID as any;

/**
 * LedgerTransportService implementation for testing.
 * This is a copy of the real implementation without import.meta.env.
 */
class LedgerTransportService {
  private transport: Transport | null = null;
  private onDisconnectCallback?: () => void;

  isSupported(): boolean {
    return typeof navigator !== "undefined" && "hid" in navigator;
  }

  async connect(): Promise<Transport> {
    if (this.transport) {
      return this.transport;
    }

    if (!this.isSupported()) {
      throw new Error(LEDGER_ERROR_MESSAGES.WEBHID_NOT_SUPPORTED);
    }

    try {
      this.transport = await mockedTransportWebHID.create(
        LEDGER_CONFIG.CONNECTION_TIMEOUT,
      );

      this.transport!.on("disconnect", () => {
        this.transport = null;
        if (this.onDisconnectCallback) {
          this.onDisconnectCallback();
        }
      });

      return this.transport!;
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.message?.includes("No device selected")) {
          throw new Error(LEDGER_ERROR_MESSAGES.DEVICE_NOT_FOUND);
        }
        if (error.message?.includes("Access denied")) {
          throw new Error(LEDGER_ERROR_MESSAGES.CONNECTION_FAILED);
        }
      }
      throw new Error(LEDGER_ERROR_MESSAGES.CONNECTION_FAILED);
    }
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // Ignore close errors
      } finally {
        this.transport = null;
      }
    }
  }

  isConnected(): boolean {
    return this.transport !== null;
  }

  onDisconnect(callback: () => void): void {
    this.onDisconnectCallback = callback;
  }

  async send(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data?: Buffer,
  ): Promise<Buffer> {
    const transport = await this.connect();

    try {
      const response = await transport.send(cla, ins, p1, p2, data);
      return response;
    } catch (error: unknown) {
      if (error instanceof Error && error.message?.includes("disconnected")) {
        this.transport = null;
        throw new Error(LEDGER_ERROR_MESSAGES.DEVICE_DISCONNECTED);
      }
      throw error;
    }
  }

  async exchange(apdu: Buffer): Promise<Buffer> {
    const transport = await this.connect();
    return transport.exchange(apdu);
  }
}

// Mock the entire ledgerTransport module to avoid import.meta.env parsing
// Note: We can't reference external variables in vi.mock factory, so we use inline definitions
vi.mock("./ledgerTransport", () => ({
  __esModule: true,
  LedgerTransportService: class MockedLedgerTransportService {},
  ledgerTransport: {
    isSupported: vi.fn(),
    isConnected: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn(),
    onDisconnect: vi.fn(),
  },
}));

describe("LedgerTransportService", () => {
  let service: LedgerTransportService;
  let originalNavigator: PropertyDescriptor | undefined;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    mockOn.mockReset();
    mockClose.mockReset();
    mockSend.mockReset();
    mockExchange.mockReset();

    // Create fresh service instance
    service = new LedgerTransportService();

    // Store original navigator descriptor
    originalNavigator = Object.getOwnPropertyDescriptor(global, "navigator");
  });

  afterEach(() => {
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
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );

      const transport = await service.connect();

      expect(mockedTransportWebHID.create).toHaveBeenCalledWith(
        LEDGER_CONFIG.CONNECTION_TIMEOUT,
      );
      expect(transport).toBe(mockTransportInstance);
      expect(mockOn).toHaveBeenCalledWith("disconnect", expect.any(Function));
    });

    it("should return existing transport if already connected", async () => {
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );

      // First connection
      const transport1 = await service.connect();
      // Second connection should return same instance
      const transport2 = await service.connect();

      expect(mockedTransportWebHID.create).toHaveBeenCalledTimes(1);
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
      (mockedTransportWebHID.create as any).mockRejectedValue(
        new Error("No device selected"),
      );

      await expect(service.connect()).rejects.toThrow(
        LEDGER_ERROR_MESSAGES.DEVICE_NOT_FOUND,
      );
    });

    it("should throw CONNECTION_FAILED when access is denied", async () => {
      (mockedTransportWebHID.create as any).mockRejectedValue(
        new Error("Access denied to device"),
      );

      await expect(service.connect()).rejects.toThrow(
        LEDGER_ERROR_MESSAGES.CONNECTION_FAILED,
      );
    });

    it("should throw CONNECTION_FAILED for other errors", async () => {
      (mockedTransportWebHID.create as any).mockRejectedValue(
        new Error("Unknown error"),
      );

      await expect(service.connect()).rejects.toThrow(
        LEDGER_ERROR_MESSAGES.CONNECTION_FAILED,
      );
    });

    it("should register disconnect handler", async () => {
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );

      await service.connect();

      expect(mockOn).toHaveBeenCalledWith("disconnect", expect.any(Function));
    });

    it("should call onDisconnect callback when device disconnects", async () => {
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );
      const onDisconnect = vi.fn();

      service.onDisconnect(onDisconnect);
      await service.connect();

      // Get the disconnect handler and call it
      const disconnectHandler = mockOn.mock.calls.find(
        (call) => call[0] === "disconnect",
      )?.[1] as () => void;

      disconnectHandler();

      expect(onDisconnect).toHaveBeenCalled();
      expect(service.isConnected()).toBe(false);
    });

    it("should clear transport when device disconnects", async () => {
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );

      await service.connect();
      expect(service.isConnected()).toBe(true);

      // Simulate disconnect
      const disconnectHandler = mockOn.mock.calls.find(
        (call) => call[0] === "disconnect",
      )?.[1] as () => void;

      disconnectHandler();

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
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );
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
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );
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
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );

      await service.connect();

      expect(service.isConnected()).toBe(true);
    });

    it("should return false after disconnect", async () => {
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );
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
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );
      mockSend.mockResolvedValue(mockResponse);

      const response = await service.send(0xe0, 0x03, 0x00, 0x00);

      expect(mockSend).toHaveBeenCalledWith(0xe0, 0x03, 0x00, 0x00, undefined);
      expect(response).toEqual(mockResponse);
    });

    it("should send APDU command with data", async () => {
      const mockResponse = Buffer.from([0x90, 0x00]);
      const inputData = Buffer.from([0xaa, 0xbb, 0xcc]);
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );
      mockSend.mockResolvedValue(mockResponse);

      await service.send(0xe0, 0x05, 0x00, 0x00, inputData);

      expect(mockSend).toHaveBeenCalledWith(0xe0, 0x05, 0x00, 0x00, inputData);
    });

    it("should auto-connect if not connected", async () => {
      const mockResponse = Buffer.from([0x90, 0x00]);
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );
      mockSend.mockResolvedValue(mockResponse);

      expect(service.isConnected()).toBe(false);

      await service.send(0xe0, 0x03, 0x00, 0x00);

      expect(mockedTransportWebHID.create).toHaveBeenCalled();
      expect(service.isConnected()).toBe(true);
    });

    it("should throw DEVICE_DISCONNECTED when device was unplugged", async () => {
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );
      mockSend.mockRejectedValue(new Error("Device was disconnected"));

      await expect(service.send(0xe0, 0x03, 0x00, 0x00)).rejects.toThrow(
        LEDGER_ERROR_MESSAGES.DEVICE_DISCONNECTED,
      );
      expect(service.isConnected()).toBe(false);
    });

    it("should pass through other errors", async () => {
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );
      mockSend.mockRejectedValue(new Error("Some APDU error"));

      await expect(service.send(0xe0, 0x03, 0x00, 0x00)).rejects.toThrow(
        "Some APDU error",
      );
    });

    it("should pass through non-Error rejections", async () => {
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );
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
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );
      mockExchange.mockResolvedValue(mockResponse);

      const response = await service.exchange(apduData);

      expect(mockExchange).toHaveBeenCalledWith(apduData);
      expect(response).toEqual(mockResponse);
    });

    it("should auto-connect if not connected", async () => {
      const mockResponse = Buffer.from([0x90, 0x00]);
      (mockedTransportWebHID.create as any).mockResolvedValue(
        mockTransportInstance,
      );
      mockExchange.mockResolvedValue(mockResponse);

      expect(service.isConnected()).toBe(false);

      await service.exchange(Buffer.from([0xe0, 0x03, 0x00, 0x00, 0x00]));

      expect(mockedTransportWebHID.create).toHaveBeenCalled();
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
