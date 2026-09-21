import { toCanonicalQrlAddress } from "@/utilities/addressUtil";
import type { Filter } from "@theqrl/web3-types";

export const QIP55_LOG_TOPIC_ERROR =
  "QIP-55 log topics must use the exact VM64 form: 0x followed by 128 hexadecimal characters. A 32-byte topic cannot be padded without knowing its ABI type.";

type UnknownLogFilter = {
  address?: unknown;
  topics?: unknown;
  [key: string]: unknown;
};

const isVm64Topic = (topic: unknown): topic is string =>
  typeof topic === "string" && /^0x[0-9a-fA-F]{128}$/.test(topic);

const assertVm64Topics = (topics: unknown): void => {
  if (topics === undefined) return;
  if (!Array.isArray(topics)) throw new Error(QIP55_LOG_TOPIC_ERROR);
  for (const topic of topics) {
    if (topic === null) continue;
    if (Array.isArray(topic)) {
      if (!topic.every(isVm64Topic)) throw new Error(QIP55_LOG_TOPIC_ERROR);
      continue;
    }
    if (!isVm64Topic(topic)) throw new Error(QIP55_LOG_TOPIC_ERROR);
  }
};

/**
 * Keep raw provider log requests inside the currently supported QIP-55
 * boundary. The caller must supply exact 64-byte VM topics because generic
 * 32-byte values do not carry enough ABI information for safe padding.
 */
export const prepareQip55LogFilter = (filter: unknown): Filter => {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    throw new Error("QRL log filter must be an object");
  }

  const candidate = filter as UnknownLogFilter;
  assertVm64Topics(candidate.topics);

  const normalizedAddress = Array.isArray(candidate.address)
    ? candidate.address.map(toCanonicalQrlAddress)
    : candidate.address === undefined
      ? undefined
      : toCanonicalQrlAddress(candidate.address);

  return {
    ...candidate,
    ...(normalizedAddress === undefined ? {} : { address: normalizedAddress }),
  } as Filter;
};
