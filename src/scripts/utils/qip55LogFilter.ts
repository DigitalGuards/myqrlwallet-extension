import { toCanonicalQrlAddress } from "@/utilities/addressUtil";
import { isRecord } from "@/utilities/storageGuards";
import { isUnknownArray } from "@/utilities/approvalGuards";

export const QIP55_LOG_TOPIC_ERROR =
  "QIP-55 log topics must use the exact VM64 form: 0x followed by 128 hexadecimal characters. A 32-byte topic cannot be padded without knowing its ABI type.";

const isVm64Topic = (topic: unknown): topic is string =>
  typeof topic === "string" && /^0x[0-9a-fA-F]{128}$/.test(topic);

const assertVm64Topics = (topics: unknown): void => {
  if (topics === undefined) return;
  if (!isUnknownArray(topics)) throw new Error(QIP55_LOG_TOPIC_ERROR);
  for (const topic of topics) {
    if (topic === null) continue;
    if (isUnknownArray(topic)) {
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
 * Other fields retain their raw values for validation by the RPC endpoint.
 */
export const prepareQip55LogFilter = (
  filter: unknown,
): Record<string, unknown> => {
  if (!isRecord(filter)) {
    throw new Error("QRL log filter must be an object");
  }

  const candidate = filter;
  assertVm64Topics(candidate.topics);

  const normalizedAddress = isUnknownArray(candidate.address)
    ? candidate.address.map(toCanonicalQrlAddress)
    : candidate.address === undefined
      ? undefined
      : toCanonicalQrlAddress(candidate.address);

  return {
    ...candidate,
    ...(normalizedAddress === undefined ? {} : { address: normalizedAddress }),
  };
};
