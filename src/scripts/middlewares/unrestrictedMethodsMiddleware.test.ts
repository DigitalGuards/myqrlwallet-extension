import { beforeEach, describe, expect, it, vi } from "vitest";
import { unrestrictedMethodsMiddleware } from "./unrestrictedMethodsMiddleware";

const { execute, isLocked, readGrants } = vi.hoisted(() => ({
  execute: vi.fn<() => Promise<unknown>>(),
  isLocked:
    vi.fn<() => Promise<{ isLocked: boolean; hasPasswordSet: boolean }>>(),
  readGrants: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("../utils/unrestrictedMethodExecutor", () => ({
  executeUnrestrictedMethod: execute,
}));
vi.mock("../lockManager/lockManager", () => ({ default: { isLocked } }));
vi.mock("@/utilities/storageUtil", () => ({
  default: { getDAppsConnectedAccountsData: readGrants },
}));

type Response = Parameters<typeof unrestrictedMethodsMiddleware>[1];

const start = (method: string) => {
  const response: Response = { id: 1, jsonrpc: "2.0" };
  const next = vi.fn();
  const end = vi.fn();
  const completion = new Promise<void>((resolve) => {
    unrestrictedMethodsMiddleware(
      {
        id: 1,
        jsonrpc: "2.0",
        method,
        senderData: { url: "https://dapp.example" },
      },
      response,
      (...args) => {
        next(...args);
        resolve();
      },
      (...args) => {
        end(...args);
        resolve();
      },
    );
  });
  return { response, next, end, completion };
};

const run = async (method: string) => {
  const call = start(method);
  await call.completion;
  return call;
};

beforeEach(() => {
  execute.mockReset().mockResolvedValue(null);
  isLocked
    .mockReset()
    .mockResolvedValue({ isLocked: false, hasPasswordSet: true });
  readGrants.mockReset().mockResolvedValue(undefined);
});

describe("unrestricted RPC response boundaries", () => {
  it.each([null, false, 0, "0x1", [], { result: [true, { value: "0x1" }] }])(
    "preserves JSON response %j",
    async (result) => {
      execute.mockResolvedValue(result);
      const { response, end, next } = await run("qrl_chainId");
      expect(response.result).toBe(result);
      expect(response.error).toBeUndefined();
      expect(end).toHaveBeenCalledExactlyOnceWith();
      expect(next).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 1n, { value: undefined }, { value: 1n }])(
    "refuses a non-JSON response (%s)",
    async (result) => {
      execute.mockResolvedValue(result);
      const { response, end } = await run("qrl_chainId");
      expect(response.error).toMatchObject({
        code: 4200,
        message: "The wallet cannot parse the RPC response.",
      });
      expect(response.result).toBeUndefined();
      expect(end).toHaveBeenCalledTimes(1);
    },
  );

  it.each([new Error("RPC unavailable"), "RPC unavailable"])(
    "keeps the RPC rejection message (%s)",
    async (error) => {
      execute.mockRejectedValue(error);
      const { response, end } = await run("qrl_chainId");
      expect(response.error).toMatchObject({
        code: 4200,
        message: "RPC unavailable",
      });
      expect(end).toHaveBeenCalledTimes(1);
    },
  );

  it("ends only after the RPC result arrives", async () => {
    let complete: (value: unknown) => void = () => {
      throw new Error("RPC was not started");
    };
    execute.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const { response, end, completion } = start("qrl_chainId");
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledTimes(1);
    });
    expect(end).not.toHaveBeenCalled();
    complete("0x301825");
    await completion;
    expect(response.result).toBe("0x301825");
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("continues to the next middleware for restricted methods", async () => {
    const { next, end } = await run("personal_sign");
    expect(next).toHaveBeenCalledExactlyOnceWith();
    expect(end).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps the disconnected error for an unlocked origin without grants", async () => {
    const { response, end } = await run("qrl_accounts");
    expect(response.error).toMatchObject({
      code: 4100,
      message: "The dApp is not connected to MyQRLWallet.",
    });
    expect(end).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("reports a rejected connection read through the engine callback", async () => {
    const error = new Error("Stored grants unavailable");
    readGrants.mockRejectedValue(error);
    const { end, next } = await run("qrl_accounts");
    expect(end).toHaveBeenCalledExactlyOnceWith(error);
    expect(next).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["locked", "unreadable"])(
    "keeps the account connection gate private while %s",
    async (state) => {
      if (state === "locked")
        isLocked.mockResolvedValue({ isLocked: true, hasPasswordSet: true });
      else isLocked.mockRejectedValue(new Error("Lock state unavailable"));
      execute.mockResolvedValue([]);
      const { response } = await run("qrl_accounts");
      expect(response.result).toEqual([]);
      expect(readGrants).not.toHaveBeenCalled();
    },
  );
});
