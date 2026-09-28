import react from "@vitejs/plugin-react-swc";
import path from "path";
import { configDefaults, defineConfig } from "vitest/config";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
  },
  resolve: {
    alias: [
      // Test-specific aliases: order matters, more specific first
      {
        find: /^@\/stores\/store$/,
        replacement: path.resolve(__dirname, "src/__mocks__/mockedStore.ts"),
      },
      {
        find: /^webextension-polyfill$/,
        replacement: path.resolve(
          __dirname,
          "src/__mocks__/mockedWebExtensionPolyfill.ts",
        ),
      },
      {
        find: /^@\/i18n$/,
        replacement: path.resolve(__dirname, "src/__mocks__/i18nTestSetup.ts"),
      },
      // Base aliases from vite.config
      { find: "@", replacement: path.resolve(__dirname, "src") },
      {
        find: "events",
        replacement: path.resolve(
          __dirname,
          "node_modules/rollup-plugin-node-polyfills/polyfills/events.js",
        ),
      },
      { find: "buffer", replacement: "buffer" },
    ],
  },
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "e2e/**"],
    clearMocks: true,
    globals: false,
    setupFiles: ["src/__mocks__/i18nTestSetup.ts", "vitest.setup.ts"],
    // Pinned (L3b, PR #71 audit): with no cap, `npx vitest run` spawns up
    // to one fork per core. On a box shared with other work, that many
    // concurrent jsdom environments starved individual tests of CPU time,
    // and a handful of waitFor()-heavy component tests intermittently hit
    // their timeout under that contention, both locally and (since CI runs
    // on similarly shared runners) potentially in CI. 4 keeps real
    // parallelism while giving each worker enough of a CPU share that a
    // waitFor() timeout means a real bug, with scheduling noise ruled out.
    poolOptions: {
      forks: {
        maxForks: 4,
        minForks: 1,
      },
    },
    server: {
      deps: {
        inline: ["@theqrl/abi", "@theqrl/qrl-cryptography", "@noble/hashes"],
      },
    },
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      exclude: ["src/components/UI/**"],
    },
  },
});
