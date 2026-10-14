export type MetadataText =
  | string
  | number
  | boolean
  | null
  | undefined
  | MetadataText[];

export const isMetadataText = (value: unknown): value is MetadataText => {
  const frames = [{ values: [value], index: 0 }];
  const ancestors = new Set<unknown[]>();

  // Keep traversal state on the heap so nested JSON can reach the renderer.
  // Only active ancestors form a cycle; shared array children remain valid.
  for (let frame = frames.pop(); frame; frame = frames.pop()) {
    if (frame.index === frame.values.length) {
      ancestors.delete(frame.values);
      continue;
    }
    const current: unknown = frame.values[frame.index];
    frame.index += 1;
    frames.push(frame);
    if (
      current === undefined ||
      current === null ||
      typeof current === "string" ||
      typeof current === "number" ||
      typeof current === "boolean"
    ) {
      continue;
    }
    if (!Array.isArray(current) || ancestors.has(current)) return false;
    ancestors.add(current);
    frames.push({ values: current, index: 0 });
  }
  return true;
};

// Call after validation. Flat children preserve React's text order and its
// omission of booleans/nulls without exposing metadata depth to reconciliation.
export const metadataTextChildren = (value: MetadataText) => {
  if (!Array.isArray(value)) return value;
  const children: (string | number)[] = [];
  const frames = [{ values: value, index: 0 }];
  for (let frame = frames.pop(); frame; frame = frames.pop()) {
    if (frame.index === frame.values.length) continue;
    const current = frame.values[frame.index];
    frame.index += 1;
    frames.push(frame);
    if (Array.isArray(current)) {
      frames.push({ values: current, index: 0 });
    } else if (typeof current === "string" || typeof current === "number") {
      children.push(current);
    }
  }
  return children;
};

// Match String(value) for JSON and route arrays, including comma separators,
// sparse entries and repeated children. Array elements that are null, undefined
// or active ancestors contribute empty text, as with Array.prototype.join.
export const metadataValueToString = (value: unknown): string => {
  if (!Array.isArray(value)) return String(value);
  const parts: string[] = [];
  const ancestors = new Set<unknown[]>([value]);
  const frames: { values: unknown[]; index: number }[] = [
    { values: value, index: 0 },
  ];
  for (let frame = frames.pop(); frame; frame = frames.pop()) {
    if (frame.index === frame.values.length) {
      ancestors.delete(frame.values);
      continue;
    }
    if (frame.index > 0) parts.push(",");
    const current = frame.values[frame.index];
    frame.index += 1;
    frames.push(frame);
    if (Array.isArray(current)) {
      if (ancestors.has(current)) continue;
      ancestors.add(current);
      frames.push({ values: current, index: 0 });
    } else {
      // JSON objects use scalar coercion; their nested fields are never visited.
      // Native join also preserves its TypeError for symbol array entries.
      parts.push([current].join(""));
    }
  }
  return parts.join("");
};
