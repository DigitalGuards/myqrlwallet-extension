import commonjs from "@rollup/plugin-commonjs";
import react from "@vitejs/plugin-react-swc";
import Ajv from "ajv";
import manifestV3Schema from "chrome-extension-manifest-json-schema/manifest/manifest.schema.v3.json" with { type: "json" };
import path from "path";
import nodePolyfills from "rollup-plugin-node-polyfills";
import { Plugin, defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";
import { version } from "./package.json";

const manifestAjv = new Ajv({ allErrors: true, strict: false });
for (const format of [
  "content-security-policy",
  "glob-pattern",
  "match-pattern",
  "mime-type",
]) {
  manifestAjv.addFormat(format, /.*/);
}
const validateManifest = manifestAjv.compile(manifestV3Schema);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    webExtension({
      manifest: "src/manifest.json",
      // The pinned local schema keeps manifest validation deterministic when
      // SchemaStore is unavailable or rate-limits its raw GitHub endpoint.
      skipManifestValidation: true,
      additionalInputs: ["src/scripts/inPageScript.ts"],
      disableAutoLaunch: true,
      watchFilePaths: ["src"],
      transformManifest: (manifest) => {
        manifest.version = version;
        if (!validateManifest(manifest)) {
          throw new Error(
            `Manifest is invalid: ${JSON.stringify(validateManifest.errors, null, 2)}`,
          );
        }
        return manifest;
      },
    }),
  ],
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  build: {
    outDir: "Extension",
    emptyOutDir: true,
    rollupOptions: {
      plugins: [
        commonjs({
          requireReturnsDefault: "auto",
        }),
        nodePolyfills() as Plugin,
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      events: path.resolve(
        __dirname,
        "node_modules/rollup-plugin-node-polyfills/polyfills/events.js",
      ),
      buffer: "buffer",
    },
  },
});
