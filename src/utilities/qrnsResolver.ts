import {
  isCanonicalQrlAddress,
  toCanonicalQrlAddress,
} from "@/utilities/addressUtil";
import type { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";
import { keccak_256 } from "@noble/hashes/sha3";
import { Web3RequestManager } from "@theqrl/web3-core";

const utf8 = new TextEncoder();
const QRL_ADDRESS_HEX_LENGTH = 128;
const QRNS_SUFFIX = ".qrl";

const bytesToHex = (bytes: Uint8Array): string => {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
};

const concatBytes = (first: Uint8Array, second: Uint8Array): Uint8Array => {
  const output = new Uint8Array(first.length + second.length);
  output.set(first, 0);
  output.set(second, first.length);
  return output;
};

const selector = (signature: string): string =>
  `0x${bytesToHex(keccak_256(utf8.encode(signature)).slice(0, 4))}`;

const RESOLVER_SELECTOR = selector("resolver(bytes32)");
const ADDRESS_SELECTOR = selector("addr(bytes32)");

export type QrnsResolverChainConfig = Pick<
  BlockchainDataType,
  "chainId" | "defaultRpcUrl" | "qrnsRegistryAddress"
>;

export class QrnsNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QrnsNameError";
  }
}

/** Match the conservative normalization profile in the current QNS SDK. */
export const normalizeQrnsName = (name: string): string => {
  if (name === "") return "";

  let lowered = "";
  for (const character of name) {
    const codePoint = character.codePointAt(0)!;
    lowered +=
      codePoint >= 0x41 && codePoint <= 0x5a
        ? String.fromCharCode(codePoint + 32)
        : character;
  }

  const labels = lowered.split(".");
  for (const label of labels) {
    if (label === "") {
      throw new QrnsNameError(`QRNS name contains an empty label: ${name}`);
    }
    if (!/^[a-z0-9-]+$/.test(label)) {
      throw new QrnsNameError(
        "QRNS labels accept only ASCII letters a-z, digits, and hyphens",
      );
    }
    if (/^..--/.test(label)) {
      throw new QrnsNameError(
        `QRNS label uses a reserved double-hyphen pattern: ${label}`,
      );
    }
  }
  return labels.join(".");
};

const namehash = (name: string): string => {
  const labels = name.split(".");
  let node: Uint8Array = new Uint8Array(32);
  for (let index = labels.length - 1; index >= 0; index -= 1) {
    const labelHash = keccak_256(utf8.encode(labels[index]));
    node = keccak_256(concatBytes(node, labelHash));
  }
  return `0x${bytesToHex(node)}`;
};

const encodeBytes32Argument = (value: string): string => {
  if (!/^0x[0-9a-f]{64}$/.test(value)) {
    throw new Error("QRNS namehash must be a 32-byte lowercase hex value");
  }
  return `${value.slice(2)}${"0".repeat(64)}`;
};

const decodeNativeAddress = (
  result: unknown,
  source: "registry" | "resolver",
): string | null => {
  if (result === "0x") return null;
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result)) {
    throw new Error(`QRNS ${source} returned a non-hex qrl_call result`);
  }
  if (result.length !== 2 + QRL_ADDRESS_HEX_LENGTH) {
    throw new Error(
      `QRNS ${source} returned ${(result.length - 2) / 2} address bytes; expected 64`,
    );
  }

  const addressHex = result.slice(2).toLowerCase();
  if (/^0+$/.test(addressHex)) return null;
  return toCanonicalQrlAddress(`Q${addressHex}`);
};

const validateRpcUrl = (rpcUrl: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error("QRNS requires a valid HTTP RPC URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("QRNS requires a valid HTTP RPC URL");
  }
};

const normalizeChainId = (chainId: unknown): string | null => {
  if (typeof chainId !== "string" || !/^0x[0-9a-fA-F]+$/.test(chainId)) {
    return null;
  }
  try {
    return `0x${BigInt(chainId).toString(16)}`;
  } catch {
    return null;
  }
};

const hasDeployedBytecode = (code: unknown): code is string =>
  typeof code === "string" &&
  /^0x(?:[0-9a-fA-F]{2})+$/.test(code) &&
  !/^0x0+$/.test(code);

const qrlCall = async (
  requestManager: Web3RequestManager,
  to: string,
  data: string,
): Promise<unknown> =>
  requestManager.send({
    method: "qrl_call",
    params: [{ to, data }, "latest"],
  });

/** Check whether input is a normalized QNS candidate accepted by the app. */
export const isQrnsName = (input: string): boolean => {
  try {
    return normalizeQrnsName(input).endsWith(QRNS_SUFFIX);
  } catch {
    return false;
  }
};

/**
 * Resolve through the native Hyperion QNS interface used by @qns/sdk.
 *
 * The web3 QRNS helper calls addr(bytes32,uint256), while the native resolver
 * exposes addr(bytes32). This adapter sends the two exact qrl_call frames
 * directly. A canonical per-chain registry is mandatory, so the stale web3
 * default registry placeholder can never be selected implicitly.
 */
export async function resolveQrnsName(
  name: string,
  chain: QrnsResolverChainConfig,
): Promise<string> {
  const {
    chainId,
    defaultRpcUrl: rpcUrl,
    qrnsRegistryAddress: registryAddress,
  } = chain;
  if (
    registryAddress === undefined ||
    registryAddress === null ||
    registryAddress === ""
  ) {
    throw new Error("QRNS is not configured for this chain");
  }
  if (!isCanonicalQrlAddress(registryAddress)) {
    throw new Error(
      "QRNS registry must be a canonical uppercase-Q address with 128 hexadecimal characters and a valid checksum",
    );
  }
  validateRpcUrl(rpcUrl);

  const normalizedName = normalizeQrnsName(name);
  if (!normalizedName.endsWith(QRNS_SUFFIX)) {
    throw new QrnsNameError("QRNS names used by the wallet must end in .qrl");
  }

  const encodedNode = encodeBytes32Argument(namehash(normalizedName));
  const requestManager = new Web3RequestManager(rpcUrl);

  const expectedChainId = normalizeChainId(chainId);
  if (!expectedChainId) {
    throw new Error("QRNS requires a valid selected chain ID");
  }
  const connectedChainId = normalizeChainId(
    await requestManager.send({ method: "qrl_chainId", params: [] }),
  );
  if (connectedChainId !== expectedChainId) {
    throw new Error("QRNS RPC chain does not match the selected chain");
  }

  const registryCode = await requestManager.send({
    method: "qrl_getCode",
    params: [registryAddress, "latest"],
  });
  if (!hasDeployedBytecode(registryCode)) {
    throw new Error("QRNS registry is not deployed on the selected chain");
  }

  const resolverResult = await qrlCall(
    requestManager,
    registryAddress,
    `${RESOLVER_SELECTOR}${encodedNode}`,
  );
  const resolverAddress = decodeNativeAddress(resolverResult, "registry");
  if (!resolverAddress) {
    throw new Error(`QRNS name has no resolver: ${normalizedName}`);
  }

  const addressResult = await qrlCall(
    requestManager,
    resolverAddress,
    `${ADDRESS_SELECTOR}${encodedNode}`,
  );
  const resolvedAddress = decodeNativeAddress(addressResult, "resolver");
  if (!resolvedAddress) {
    throw new Error(`QRNS name has no address record: ${normalizedName}`);
  }
  return resolvedAddress;
}
