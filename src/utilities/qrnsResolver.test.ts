import { beforeEach, describe, expect, it, vi } from "vitest";
import { toChecksumAddress } from "@theqrl/wallet.js";

const { constructRequestManager, send } = vi.hoisted(() => ({
  constructRequestManager: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@theqrl/web3-core", () => ({
  Web3RequestManager: class {
    constructor(provider: string) {
      constructRequestManager(provider);
    }

    send = send;
  },
}));

import { isQrnsName, normalizeQrnsName, resolveQrnsName } from "./qrnsResolver";

const RPC_URL = "https://rpc.example";
const REGISTRY = toChecksumAddress(`Q${"a".repeat(128)}`);
const RESOLVER = toChecksumAddress(`Q${"b".repeat(128)}`);
const ADDRESS = toChecksumAddress(`Q${"c".repeat(128)}`);
const CHAIN = {
  chainId: "0x539",
  defaultRpcUrl: RPC_URL,
  qrnsRegistryAddress: REGISTRY,
};
const WRONG_CHECKSUM_ADDRESS = `${REGISTRY.slice(0, 1)}${
  REGISTRY[1] === REGISTRY[1].toUpperCase()
    ? REGISTRY[1].toLowerCase()
    : REGISTRY[1].toUpperCase()
}${REGISTRY.slice(2)}`;
const ALICE_QRL_NAMEHASH =
  "efe3586aa9a851831a32d38044822af21cc5380e38f05cdc0dd562b4cfada103";
const ENCODED_ALICE_NODE = `${ALICE_QRL_NAMEHASH}${"0".repeat(64)}`;

describe("native QNS resolver adapter", () => {
  beforeEach(() => {
    constructRequestManager.mockReset();
    send.mockReset();
  });

  it("uses the local QNS SDK namehash and exact 64-byte ABI call frames", async () => {
    send
      .mockResolvedValueOnce("0x539")
      .mockResolvedValueOnce("0x6000")
      .mockResolvedValueOnce(`0x${RESOLVER.slice(1).toLowerCase()}`)
      .mockResolvedValueOnce(`0x${ADDRESS.slice(1).toLowerCase()}`);

    await expect(resolveQrnsName("Alice.QRL", CHAIN)).resolves.toBe(ADDRESS);

    expect(constructRequestManager).toHaveBeenCalledOnce();
    expect(constructRequestManager).toHaveBeenCalledWith(RPC_URL);
    expect(send).toHaveBeenNthCalledWith(1, {
      method: "qrl_chainId",
      params: [],
    });
    expect(send).toHaveBeenNthCalledWith(2, {
      method: "qrl_getCode",
      params: [REGISTRY, "latest"],
    });
    expect(send).toHaveBeenNthCalledWith(3, {
      method: "qrl_call",
      params: [
        {
          to: REGISTRY,
          data: `0x0178b8bf${ENCODED_ALICE_NODE}`,
        },
        "latest",
      ],
    });
    expect(send).toHaveBeenNthCalledWith(4, {
      method: "qrl_call",
      params: [
        {
          to: RESOLVER,
          data: `0x3b3b57de${ENCODED_ALICE_NODE}`,
        },
        "latest",
      ],
    });
  });

  it.each(["Alice.QRL", "sub.alice.qrl", "a-1.qrl"])(
    "accepts a conservative ASCII QNS name (%s)",
    (name) => {
      expect(isQrnsName(name)).toBe(true);
    },
  );

  it.each([
    "alice",
    "alice..qrl",
    ".alice.qrl",
    "alice.qrl.",
    " alice.qrl",
    "alice.qrl ",
    "álîce.qrl",
    "alice_name.qrl",
    "ab--reserved.qrl",
  ])("rejects a name outside the conservative QNS profile (%s)", (name) => {
    expect(isQrnsName(name)).toBe(false);
  });

  it("normalizes ASCII uppercase without changing the pinned namehash", () => {
    expect(normalizeQrnsName("Alice.QRL")).toBe("alice.qrl");
  });

  it.each([undefined, null, ""])(
    "fails closed when the active chain has no configured registry (%s)",
    async (registryAddress) => {
      await expect(
        resolveQrnsName("alice.qrl", {
          ...CHAIN,
          qrnsRegistryAddress: registryAddress as never,
        }),
      ).rejects.toThrow("not configured for this chain");

      expect(constructRequestManager).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([
    `Q${"d".repeat(40)}`,
    WRONG_CHECKSUM_ADDRESS,
    `q${REGISTRY.slice(1)}`,
    `0x${REGISTRY.slice(1)}`,
    `Q${REGISTRY.slice(1).toLowerCase()}`,
    0,
    false,
    Number.NaN,
    0n,
  ])(
    "rejects a noncanonical registry before making an RPC request (%s)",
    async (registryAddress) => {
      await expect(
        resolveQrnsName("alice.qrl", {
          ...CHAIN,
          qrnsRegistryAddress: registryAddress as never,
        }),
      ).rejects.toThrow("canonical uppercase-Q address");

      expect(constructRequestManager).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each(["invalid", "ws://rpc.example"])(
    "rejects an unsupported RPC URL before constructing a provider (%s)",
    async (rpcUrl) => {
      await expect(
        resolveQrnsName("alice.qrl", { ...CHAIN, defaultRpcUrl: rpcUrl }),
      ).rejects.toThrow("valid HTTP RPC URL");

      expect(constructRequestManager).not.toHaveBeenCalled();
    },
  );

  it("fails closed before registry or resolver calls when the RPC chain differs", async () => {
    send.mockResolvedValue("0x1");

    await expect(resolveQrnsName("alice.qrl", CHAIN)).rejects.toThrow(
      "does not match the selected chain",
    );

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ method: "qrl_chainId", params: [] });
  });

  it.each(["0x", "0x00", "malformed", null])(
    "fails closed before resolver calls when the registry has no code (%s)",
    async (code) => {
      send.mockResolvedValueOnce("0x539").mockResolvedValueOnce(code);

      await expect(resolveQrnsName("alice.qrl", CHAIN)).rejects.toThrow(
        "registry is not deployed on the selected chain",
      );

      expect(send).toHaveBeenCalledTimes(2);
      expect(
        send.mock.calls.some(([request]) => request.method === "qrl_call"),
      ).toBe(false);
    },
  );

  it("fails closed when the registry has no resolver", async () => {
    send
      .mockResolvedValueOnce("0x539")
      .mockResolvedValueOnce("0x6000")
      .mockResolvedValueOnce(`0x${"0".repeat(128)}`);

    await expect(resolveQrnsName("alice.qrl", CHAIN)).rejects.toThrow(
      "has no resolver",
    );
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("fails closed when the resolver has no address record", async () => {
    send
      .mockResolvedValueOnce("0x539")
      .mockResolvedValueOnce("0x6000")
      .mockResolvedValueOnce(`0x${RESOLVER.slice(1)}`)
      .mockResolvedValueOnce("0x");

    await expect(resolveQrnsName("alice.qrl", CHAIN)).rejects.toThrow(
      "has no address record",
    );
  });

  it.each(["0x1234", `0x${"1".repeat(130)}`, false])(
    "rejects malformed native address return data (%s)",
    async (resolverResult) => {
      send
        .mockResolvedValueOnce("0x539")
        .mockResolvedValueOnce("0x6000")
        .mockResolvedValueOnce(resolverResult);

      await expect(resolveQrnsName("alice.qrl", CHAIN)).rejects.toThrow(
        /qrl_call result|address bytes/,
      );
    },
  );

  it("propagates RPC failures without attempting the second call", async () => {
    send.mockRejectedValue(new Error("RPC unavailable"));

    await expect(resolveQrnsName("alice.qrl", CHAIN)).rejects.toThrow(
      "RPC unavailable",
    );
    expect(send).toHaveBeenCalledOnce();
  });
});
