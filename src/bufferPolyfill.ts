import { Buffer } from "buffer";

/**
 * Installs the Buffer global that the Ledger transport libraries expect.
 *
 * This lives in its own module, imported first by main.tsx, because ES
 * modules hoist every import declaration above the module body: doing
 * `import { Buffer } from "buffer"; globalThis.Buffer = Buffer;` inside
 * main.tsx runs the assignment only after the whole application graph
 * (App.tsx and everything under it) has already been evaluated. Parts of
 * @ledgerhq touch `Buffer.alloc(...)` at module top level, so whether the
 * popup booted or died with "Buffer is not defined" came down to whether
 * the bundler happened to wrap those modules in a lazy CommonJS require
 * shim, which any unrelated change to the module graph can flip.
 *
 * Importing this module first makes the global deterministic: it depends
 * only on `buffer`, so it is fully evaluated before the next import in
 * main.tsx is touched.
 */
globalThis.Buffer = globalThis.Buffer ?? Buffer;
