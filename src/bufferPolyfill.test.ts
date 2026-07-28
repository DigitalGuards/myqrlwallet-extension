import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The Buffer global has to exist before any @ledgerhq module is evaluated:
 * parts of that stack call Buffer.alloc(...) at module top level, and ES
 * imports are hoisted above the module body, so an assignment written
 * inside main.tsx would run only after the whole app graph had loaded.
 * When it lands on the wrong side, every surface renders blank with
 * "Buffer is not defined" and no unit test, typecheck or build fails.
 */
describe("Buffer polyfill ordering", () => {
  const readSource = (relativePath: string) =>
    readFileSync(resolve(process.cwd(), relativePath), "utf8");

  it("makes bufferPolyfill the first import in the entry module", () => {
    const main = readSource("src/main.tsx");
    const firstImport = main
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("import "));

    expect(firstImport).toMatch(/bufferPolyfill/);
  });

  it("does not assign the global from inside the entry module", () => {
    // Hoisting makes an assignment here run too late, whatever its position
    // in the file looks like.
    const main = readSource("src/main.tsx");

    expect(main).not.toMatch(/globalThis\.Buffer\s*=/);
  });

  it("installs the global in the polyfill module", () => {
    const polyfill = readSource("src/bufferPolyfill.ts");

    expect(polyfill).toMatch(/import \{ Buffer \} from "buffer"/);
    expect(polyfill).toMatch(/globalThis\.Buffer\s*=/);
  });
});
