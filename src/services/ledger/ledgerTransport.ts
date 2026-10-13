/**
 * Ledger Transport Layer - WebHID wrapper with Speculos emulator support.
 *
 * ARCHITECTURE (Production - Real Device):
 * ┌─────────────────────────────────────────────────────────────┐
 * │  LedgerService (business logic)                             │
 * │      ↓                                                      │
 * │  LedgerTransport (this file - WebHID abstraction)           │
 * │      ↓                                                      │
 * │  @ledgerhq/hw-transport-webhid (Ledger library)             │
 * │      ↓                                                      │
 * │  WebHID API (browser)                                       │
 * │      ↓                                                      │
 * │  USB Driver (operating system)                              │
 * │      ↓                                                      │
 * │  Ledger Device (physical device)                            │
 * └─────────────────────────────────────────────────────────────┘
 *
 * ARCHITECTURE (Development - Speculos Emulator):
 * ┌─────────────────────────────────────────────────────────────┐
 * │  LedgerService (business logic)                             │
 * │      ↓                                                      │
 * │  LedgerTransport (this file - delegates to Speculos)        │
 * │      ↓                                                      │
 * │  SpeculosTransport (HTTP client)                            │
 * │      ↓                                                      │
 * │  fetch() API → HTTP POST to localhost:5000/apdu             │
 * │      ↓                                                      │
 * │  Speculos Emulator (emulated Ledger app)                    │
 * └─────────────────────────────────────────────────────────────┘
 */

import TransportWebHID from "@ledgerhq/hw-transport-webhid";
import type Transport from "@ledgerhq/hw-transport";
import { LEDGER_CONFIG, LEDGER_ERROR_MESSAGES } from "@/constants/ledger";
import {
  speculosTransport,
  SpeculosTransportService,
} from "./speculosTransport";

function isErrorWithMessage(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }
  const message: unknown = error.message;
  return typeof message === "string";
}

/**
 * Check if Speculos mode is enabled via environment variable.
 * In Vite, environment variables are accessed via import.meta.env
 */
const USE_SPECULOS = import.meta.env.VITE_USE_SPECULOS === "true";

if (USE_SPECULOS) {
  console.log(
    "[LedgerTransport] SPECULOS MODE ENABLED - Using emulator instead of real device",
  );
}

/**
 * Transport interface that both WebHID and Speculos transports implement.
 */
export interface ILedgerTransport {
  isSupported(): boolean;
  isConnected(): boolean;
  connect(): Promise<unknown>;
  disconnect(): Promise<void>;
  send(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data?: Buffer | Uint8Array,
  ): Promise<Buffer>;
  onDisconnect(callback: () => void): void;
}

/**
 * Ledger Transport Service.
 *
 * Singleton responsible for:
 * - Establishing/closing connection with the device
 * - Sending APDU commands to the device
 * - Handling connection/disconnection events
 *
 */
export class LedgerTransportService implements ILedgerTransport {
  /** Active transport connection (null = disconnected) */
  private transport: Transport | null = null;

  /** Event callbacks */
  private onDisconnectCallback?: () => void;

  /**
   * Checks if the browser supports WebHID.
   *
   * @returns true if WebHID is available
   */
  isSupported(): boolean {
    // Check synchronously - WebHID is available if navigator.hid exists
    // TransportWebHID.isSupported() returns Promise, but we need sync check
    return typeof navigator !== "undefined" && "hid" in navigator;
  }

  /**
   * Establishes connection with Ledger device.
   *
   * IMPORTANT - USER GESTURE:
   * This method MUST be called in response to user action
   * (e.g., button click). WebHID requires this for security.
   * Calling without user gesture will cause an error.
   *
   * FLOW:
   * 1. Check if there's already an active connection
   * 2. Open device selection dialog (controlled by browser)
   * 3. User selects Ledger device
   * 4. Establish WebHID connection
   * 5. Register disconnect handler
   *
   * @throws Error if connection fails
   * @returns Transport for sending APDU commands
   */
  async connect(): Promise<Transport> {
    // If already connected, return existing transport
    if (this.transport) {
      return this.transport;
    }

    // Check browser support
    if (!this.isSupported()) {
      throw new Error(LEDGER_ERROR_MESSAGES.WEBHID_NOT_SUPPORTED);
    }

    try {
      // TransportWebHID.create() will open device selection dialog
      // Dialog is controlled by browser (we cannot customize it)
      this.transport = await TransportWebHID.create(
        LEDGER_CONFIG.CONNECTION_TIMEOUT,
      );

      // Listen for device disconnection
      // (e.g., user unplugged USB cable)
      this.transport.on("disconnect", () => {
        console.log("[LedgerTransport] Device disconnected");
        this.transport = null;

        // Call callback if registered
        if (this.onDisconnectCallback) {
          this.onDisconnectCallback();
        }
      });

      console.log("[LedgerTransport] Connected successfully");
      return this.transport;
    } catch (error: unknown) {
      console.error("[LedgerTransport] Connection error:", error);

      // Map errors to readable messages
      if (isErrorWithMessage(error)) {
        if (error.message.includes("No device selected")) {
          // User closed dialog without selecting device
          throw new Error(LEDGER_ERROR_MESSAGES.DEVICE_NOT_FOUND);
        }
        if (error.message.includes("Access denied")) {
          // No permission to access device
          throw new Error(LEDGER_ERROR_MESSAGES.CONNECTION_FAILED);
        }
      }

      throw new Error(LEDGER_ERROR_MESSAGES.CONNECTION_FAILED);
    }
  }

  /**
   * Disconnects the device.
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        // Ignore close errors - device might already be disconnected
        console.warn("[LedgerTransport] Error closing transport:", error);
      } finally {
        this.transport = null;
      }
    }
  }

  /**
   * Checks if device is connected.
   *
   * NOTE:
   * This method only checks internal state (whether we have transport object).
   * Device might have been physically disconnected - we only find out
   * when attempting to send a command.
   */
  isConnected(): boolean {
    return this.transport !== null;
  }

  /**
   * Registers callback called on disconnection.
   */
  onDisconnect(callback: () => void): void {
    this.onDisconnectCallback = callback;
  }

  /**
   * Sends APDU command to the device.
   *
   * APDU (Application Protocol Data Unit) is a standard format
   * for communication with smart cards and cryptographic devices.
   *
   * APDU STRUCTURE:
   * ┌───────┬───────┬───────┬───────┬───────┬─────────────┐
   * │  CLA  │  INS  │  P1   │  P2   │  Lc   │    DATA     │
   * │  1B   │  1B   │  1B   │  1B   │  1B   │   0-255B    │
   * └───────┴───────┴───────┴───────┴───────┴─────────────┘
   *
   * RESPONSE:
   * ┌─────────────────────────────┬───────────┬───────────┐
   * │            DATA             │    SW1    │    SW2    │
   * │          0-65535B           │    1B     │    1B     │
   * └─────────────────────────────┴───────────┴───────────┘
   *
   * SW1+SW2 (Status Word) = operation result code:
   * - 0x9000 = success
   * - 0x6985 = user rejected
   * - 0x6E00 = wrong app (CLA not supported)
   *
   * @param cla - Class byte (application identifier, e.g., 0xE0 for QRL Zond)
   * @param ins - Instruction byte (operation code, e.g., 0x05 = GET_PUBLIC_KEY)
   * @param p1 - Parameter 1 (depends on instruction)
   * @param p2 - Parameter 2 (depends on instruction)
   * @param data - Optional input data
   * @returns Buffer with response (DATA + SW1 + SW2)
   */
  async send(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data?: Buffer,
  ): Promise<Buffer> {
    // Ensure we are connected
    const transport = await this.connect();

    try {
      // Send APDU command
      // Ledger library automatically handles:
      // - Packet formatting
      // - Timeout
      // - Retry on some errors
      const response = await transport.send(cla, ins, p1, p2, data);
      return response;
    } catch (error: unknown) {
      // Check if device was disconnected
      if (isErrorWithMessage(error) && error.message.includes("disconnected")) {
        this.transport = null;
        throw new Error(LEDGER_ERROR_MESSAGES.DEVICE_DISCONNECTED);
      }

      // Pass error through (will be handled by higher layer)
      throw error;
    }
  }

  /**
   * Sends raw data to the device.
   */
  async exchange(apdu: Buffer): Promise<Buffer> {
    const transport = await this.connect();
    return transport.exchange(apdu);
  }
}

/**
 * Wrapper that adapts SpeculosTransport to match LedgerTransportService interface.
 * Converts between Buffer and Uint8Array as needed.
 */
class SpeculosTransportWrapper implements ILedgerTransport {
  private speculos: SpeculosTransportService;

  constructor(speculos: SpeculosTransportService) {
    this.speculos = speculos;
  }

  isSupported(): boolean {
    return this.speculos.isSupported();
  }

  isConnected(): boolean {
    return this.speculos.isConnected();
  }

  async connect(): Promise<void> {
    return this.speculos.connect();
  }

  async disconnect(): Promise<void> {
    return this.speculos.disconnect();
  }

  async send(
    cla: number,
    ins: number,
    p1: number,
    p2: number,
    data?: Buffer | Uint8Array,
  ): Promise<Buffer> {
    const uint8Data = data ? new Uint8Array(data) : undefined;
    const response = await this.speculos.send(cla, ins, p1, p2, uint8Data);
    return Buffer.from(response);
  }

  onDisconnect(callback: () => void): void {
    this.speculos.onDisconnect(callback);
  }

  /**
   * Access underlying Speculos transport for testing utilities.
   * Only available in Speculos mode.
   */
  getSpeculosTransport(): SpeculosTransportService {
    return this.speculos;
  }
}

/**
 * Export the appropriate transport based on environment.
 * - Production: LedgerTransportService (WebHID)
 * - Development with VITE_USE_SPECULOS=true: SpeculosTransportWrapper
 */
export const ledgerTransport: ILedgerTransport = USE_SPECULOS
  ? new SpeculosTransportWrapper(speculosTransport)
  : new LedgerTransportService();
