import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyStore } from "@theqrl/web3";
import { isRecord } from "@/utilities/storageGuards";
import {
  type JobWorker,
  kdfWorkerCount,
  runWorkerJob,
  splitIntoChunks,
} from "./keystoreWorkerPool";
import {
  isChangePasswordWorkerResponse,
  isUnlockWorkerResponse,
} from "./keystoreWorkerGuards";

describe("splitIntoChunks", () => {
  it("splits contiguously and preserves order on concatenation", () => {
    const items = [1, 2, 3, 4, 5];
    const chunks = splitIntoChunks(items, 3);
    expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks.flat()).toEqual(items);
  });

  it("never produces empty chunks when chunkCount exceeds item count", () => {
    expect(splitIntoChunks([1, 2], 5)).toEqual([[1], [2]]);
  });

  it("returns a single chunk for chunkCount 1", () => {
    expect(splitIntoChunks([1, 2, 3], 1)).toEqual([[1, 2, 3]]);
  });

  it("returns no chunks for an empty list", () => {
    expect(splitIntoChunks([], 3)).toEqual([]);
  });
});

describe("kdfWorkerCount", () => {
  const setCores = (cores: number | undefined) => {
    Object.defineProperty(navigator, "hardwareConcurrency", {
      value: cores,
      configurable: true,
    });
  };

  afterEach(() => {
    setCores(undefined);
  });

  it("caps at the memory ceiling regardless of cores", () => {
    setCores(16);
    expect(kdfWorkerCount(10)).toBe(3);
  });

  it("never exceeds the item count", () => {
    setCores(8);
    expect(kdfWorkerCount(1)).toBe(1);
    expect(kdfWorkerCount(2)).toBe(2);
  });

  it("caps at the core count on small machines", () => {
    setCores(2);
    expect(kdfWorkerCount(10)).toBe(2);
  });

  it("returns at least one worker when core detection is unavailable", () => {
    setCores(undefined);
    expect(kdfWorkerCount(5)).toBe(2);
    expect(kdfWorkerCount(0)).toBe(1);
  });
});

describe("runWorkerJob", () => {
  type Req = { input: string };
  type Res = { success: boolean; echo?: string };

  const isResponse = (value: unknown): value is Res =>
    isRecord(value) &&
    typeof value.success === "boolean" &&
    (value.echo === undefined || typeof value.echo === "string");

  class FakeWorker implements JobWorker<Req> {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;
    constructor(
      private readonly behavior: "reply" | "error" | (() => unknown),
    ) {}
    postMessage(request: Req) {
      queueMicrotask(() => {
        if (this.behavior === "error") {
          this.onerror?.(new ErrorEvent("error"));
        } else {
          const data =
            this.behavior === "reply"
              ? { success: true, echo: request.input }
              : this.behavior();
          this.onmessage?.(new MessageEvent<unknown>("message", { data }));
        }
      });
    }
    terminate() {
      this.terminated = true;
    }
  }

  it("resolves with the worker response and terminates the worker", async () => {
    const worker = new FakeWorker("reply");
    const result = await runWorkerJob<Req, Res>(
      () => worker,
      { input: "hello" },
      { success: false },
      isResponse,
    );
    expect(result).toEqual({ success: true, echo: "hello" });
    expect(worker.terminated).toBe(true);
  });

  it("resolves with the failure value on worker error", async () => {
    const worker = new FakeWorker("error");
    const result = await runWorkerJob<Req, Res>(
      () => worker,
      { input: "boom" },
      { success: false },
      isResponse,
    );
    expect(result).toEqual({ success: false });
    expect(worker.terminated).toBe(true);
  });

  it("spawns a fresh worker per job", async () => {
    const factory = vi.fn(() => new FakeWorker("reply"));
    await runWorkerJob<Req, Res>(
      factory,
      { input: "a" },
      { success: false },
      isResponse,
    );
    await runWorkerJob<Req, Res>(
      factory,
      { input: "b" },
      { success: false },
      isResponse,
    );
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it.each([
    { response: null },
    { response: undefined },
    { response: [] },
    { response: "invalid" },
    { response: {} },
    { response: { success: "true" } },
    { response: { success: true, echo: 1 } },
  ])(
    "resolves malformed replies with the failure value ($response)",
    async ({ response }) => {
      const worker = new FakeWorker(() => response);
      const failure = { success: false };
      const result = await runWorkerJob<Req, Res>(
        () => worker,
        { input: "hello" },
        failure,
        isResponse,
      );
      expect(result).toBe(failure);
      expect(worker.terminated).toBe(true);
    },
  );

  it("preserves the request and valid response objects", async () => {
    const response = { success: false, echo: "worker failure" };
    const request = { input: "hello" };
    const worker = new FakeWorker(() => response);
    const postMessage = vi.spyOn(worker, "postMessage");
    await expect(
      runWorkerJob(() => worker, request, { success: false }, isResponse),
    ).resolves.toBe(response);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(request);
  });

  it("preserves worker construction and posting errors", async () => {
    const error = new Error("worker setup failed");
    await expect(
      runWorkerJob<Req, Res>(
        () => {
          throw error;
        },
        { input: "hello" },
        { success: false },
        isResponse,
      ),
    ).rejects.toBe(error);

    const worker = new FakeWorker("reply");
    vi.spyOn(worker, "postMessage").mockImplementation(() => {
      throw error;
    });
    await expect(
      runWorkerJob(
        () => worker,
        { input: "hello" },
        { success: false },
        isResponse,
      ),
    ).rejects.toBe(error);
  });
});

describe("keystore worker response guards", () => {
  const first: KeyStore = {
    version: 1,
    id: "first",
    address: `Q${"a".repeat(128)}`,
    crypto: {
      cipher: "aes-256-gcm",
      ciphertext: "ab".repeat(67),
      cipherparams: { iv: "ab".repeat(12) },
      kdf: "argon2id",
      kdfparams: { m: 262144, t: 4, p: 4, dklen: 32, salt: "ab".repeat(32) },
    },
  };
  const second: KeyStore = {
    ...first,
    id: "second",
    address: `Q${"b".repeat(128)}`,
  };
  const keystores = [first, second];
  const keys = keystores.map(({ address }) => ({
    address,
    mnemonicPhrases: "fixture mnemonic",
  }));

  it("accepts complete ordered results and explicit password failures", () => {
    expect(
      isUnlockWorkerResponse(
        { success: true, keys, upgraded: [null, second] },
        keystores,
      ),
    ).toBe(true);
    expect(
      isChangePasswordWorkerResponse(
        { success: true, newKeys: keys, newKeystores: keystores },
        keystores,
      ),
    ).toBe(true);
    for (const wrongPassword of [true, false]) {
      const response = { success: false, wrongPassword };
      expect(isUnlockWorkerResponse(response, keystores)).toBe(true);
      expect(isChangePasswordWorkerResponse(response, keystores)).toBe(true);
    }
  });

  it("preserves case-insensitive address matching and binary salts", () => {
    const binarySalt: KeyStore = {
      ...first,
      address: first.address.toLowerCase(),
      crypto: {
        ...first.crypto,
        kdfparams: { ...first.crypto.kdfparams, salt: new Uint8Array(32) },
      },
    };
    const lowerKeys = keys.map((key) => ({
      ...key,
      address: key.address.toLowerCase(),
    }));
    expect(
      isUnlockWorkerResponse(
        { success: true, keys: lowerKeys, upgraded: [binarySalt, null] },
        keystores,
      ),
    ).toBe(true);
    expect(
      isChangePasswordWorkerResponse(
        {
          success: true,
          newKeys: lowerKeys,
          newKeystores: [binarySalt, second],
        },
        keystores,
      ),
    ).toBe(true);
  });

  it.each([
    { response: null },
    { response: [] },
    { response: {} },
    { response: { success: "true" } },
    { response: { success: false } },
    { response: { success: false, wrongPassword: "false" } },
  ])("rejects malformed response envelopes ($response)", ({ response }) => {
    expect(isUnlockWorkerResponse(response, keystores)).toBe(false);
    expect(isChangePasswordWorkerResponse(response, keystores)).toBe(false);
  });

  it.each([
    { label: "missing", entries: undefined },
    { label: "non-array", entries: {} },
    { label: "empty", entries: [] },
    { label: "short", entries: keys.slice(0, 1) },
    { label: "long", entries: [...keys, ...keys] },
    { label: "reordered", entries: [...keys].reverse() },
    { label: "sparse", entries: new Array<unknown>(2) },
    {
      label: "missing mnemonic",
      entries: keystores.map(({ address }) => ({ address })),
    },
    {
      label: "invalid mnemonic",
      entries: keys.map((key) => ({ ...key, mnemonicPhrases: 1 })),
    },
  ])("rejects $label key results", ({ entries }) => {
    expect(
      isUnlockWorkerResponse(
        { success: true, keys: entries, upgraded: [null, null] },
        keystores,
      ),
    ).toBe(false);
    expect(
      isChangePasswordWorkerResponse(
        { success: true, newKeys: entries, newKeystores: keystores },
        keystores,
      ),
    ).toBe(false);
  });

  it.each([
    { label: "missing", entries: undefined },
    { label: "non-array", entries: {} },
    { label: "empty", entries: [] },
    { label: "short", entries: keystores.slice(0, 1) },
    { label: "long", entries: [...keystores, ...keystores] },
    { label: "reordered", entries: [...keystores].reverse() },
    { label: "sparse", entries: new Array<unknown>(2) },
  ])("rejects $label keystore results", ({ entries }) => {
    expect(
      isUnlockWorkerResponse(
        { success: true, keys, upgraded: entries },
        keystores,
      ),
    ).toBe(false);
    expect(
      isChangePasswordWorkerResponse(
        { success: true, newKeys: keys, newKeystores: entries },
        keystores,
      ),
    ).toBe(false);
  });

  it.each([
    { label: "missing id", field: { id: undefined } },
    { label: "invalid version", field: { version: 2 } },
    { label: "missing crypto", field: { crypto: null } },
    {
      label: "invalid cipher",
      field: { crypto: { ...first.crypto, cipher: "invalid" } },
    },
    {
      label: "invalid ciphertext",
      field: { crypto: { ...first.crypto, ciphertext: 1 } },
    },
    {
      label: "missing cipherparams",
      field: { crypto: { ...first.crypto, cipherparams: null } },
    },
    {
      label: "invalid iv",
      field: { crypto: { ...first.crypto, cipherparams: { iv: 1 } } },
    },
    {
      label: "invalid kdf",
      field: { crypto: { ...first.crypto, kdf: "invalid" } },
    },
    {
      label: "missing kdfparams",
      field: { crypto: { ...first.crypto, kdfparams: null } },
    },
    ...["salt", "m", "t", "p", "dklen"].map((field) => ({
      label: `invalid ${field}`,
      field: {
        crypto: {
          ...first.crypto,
          kdfparams: { ...first.crypto.kdfparams, [field]: null },
        },
      },
    })),
  ])("rejects keystores with $label", ({ field }) => {
    const entries = [{ ...first, ...field }, second];
    expect(
      isUnlockWorkerResponse(
        { success: true, keys, upgraded: entries },
        keystores,
      ),
    ).toBe(false);
    expect(
      isChangePasswordWorkerResponse(
        { success: true, newKeys: keys, newKeystores: entries },
        keystores,
      ),
    ).toBe(false);
  });
});
