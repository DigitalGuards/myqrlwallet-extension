import pluginJs from "@eslint/js";
import pluginJestDom from "eslint-plugin-jest-dom";
import pluginReact from "eslint-plugin-react";
import globals from "globals";
import tseslint from "typescript-eslint";

export const strictFiles = [
  "src/**/*.{ts,tsx}",
  "e2e/**/*.{ts,tsx}",
  "vitest.setup.ts",
];

export const baseConfig = [
  { ignores: ["Extension/**", "coverage/**", "scripts/**"] },
  { files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"] },
  {
    languageOptions: { globals: globals.browser },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: strictFiles,
  })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // JavaScript tooling has no TypeScript project for type-aware rules.
    ...tseslint.configs.disableTypeChecked,
    files: ["**/*.{js,mjs,cjs,jsx}"],
  },
  pluginReact.configs.flat.recommended,
  // The automatic JSX runtime supplies React without an in-scope import.
  pluginReact.configs.flat["jsx-runtime"],
  {
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      "react/display-name": "error",
      "react/no-unsafe": "error",
      "react/jsx-filename-extension": [
        "error",
        { extensions: [".js", ".jsx", ".ts", ".tsx"] },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // TypeScript types every prop in these files.
      "react/prop-types": "off",
    },
  },
  {
    // TypeScript applies @ts-nocheck in any letter case and after extra
    // slashes, while ban-ts-comment matches only the lower-case form.
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      "no-warning-comments": [
        "error",
        { terms: ["@ts-nocheck"], location: "start", decoration: ["/"] },
      ],
    },
  },
  pluginJestDom.configs["flat/recommended"],
  {
    files: strictFiles,
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-expect-error": true,
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression > TSAsExpression",
          message:
            "Double type assertions are banned. Narrow unknown input with a guard.",
        },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    files: ["src/test-utils/malformed.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as" },
      ],
    },
  },
  {
    files: ["tailwind.config.js", "postcss.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["tailwind.config.js"],
    languageOptions: { sourceType: "commonjs" },
    rules: {
      // Tailwind's CommonJS configuration loads plugins with require.
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

// Existing lint debt, including tests. Entries may only be removed.
// Regenerate with node scripts/lint-ratchet.mjs after fixing a file/rule pair.
// BEGIN LINT RATCHET
export const lintRatchet = [
];
// END LINT RATCHET

export default [...baseConfig, ...lintRatchet];
