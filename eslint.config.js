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
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportLedger/ImportLedger.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportLedger/ImportLedger.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportNFTCollection/DiscoveredNFTCollections/DiscoveredNFTCollections.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportNFTCollection/ImportNFTCollection.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportNFTCollection/NFTCollectionImportSuccess/NFTCollectionImportSuccess.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportToken/DiscoveredTokens/DiscoveredTokens.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportToken/DiscoveredTokens/DiscoveredTokens.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportToken/ImportToken.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportToken/TokenImportSuccess/TokenImportSuccess.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportToken/TokenImportSuccess/TokenImportSuccess.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/NFTDetail/NFTDetail.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/NFTDetail/NFTDetail.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TokenTransfer/GasFeeNotice/GasFeeNotice.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TokenTransfer/GasFeeNotice/GasFeeNotice.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TokenTransfer/GasFeeNotice/GasFeeSelector.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TokenTransfer/GasFeeNotice/GasFeeSelector.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TokenTransfer/RecipientPicker/RecipientPicker.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TokenTransfer/RecipientPicker/RecipientPicker.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TokenTransfer/TokenTransfer.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TokenTransfer/TokenTransfer.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TokenTransfer/TransactionSuccessful/TransactionSuccessful.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TransactionHistory/TransactionDetail/TransactionDetail.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TransactionHistory/TransactionDetail/TransactionDetail.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TransactionHistory/TransactionHistory.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TransactionHistory/TransactionHistory.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TransactionHistory/TransactionHistoryItem/TransactionHistoryItem.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/AccountBadge/AccountBadge.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-spread": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/AccountBadge/AccountBadge.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/QrlWeb3WalletMoreOptions/QrlWeb3WalletMoreOptions.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/QrlWeb3WalletMoreOptions/QrlWeb3WalletMoreOptions.tsx",
    ],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/SidePanelNotice/SidePanelNotice.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/components/UI/Form.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-template-expression": "off",
    },
  },
  {
    files: ["src/scripts/utils/approvalSurface.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/scripts/utils/restrictedMethodsMiddlewareUtils.authorization.test.ts",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/scripts/utils/unrestrictedMethodExecutor.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  {
    files: ["src/utilities/storageUtil.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
];
// END LINT RATCHET

export default [...baseConfig, ...lintRatchet];
