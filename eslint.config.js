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
    files: ["e2e/bfcacheProvider.spec.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["e2e/dAppCalldataApproval.spec.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["e2e/dataLifecycle.spec.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: ["e2e/providerMethodBinding.spec.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  {
    files: ["e2e/quantaSwapLifecycle.spec.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["e2e/quantaSwapUi.spec.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/__mocks__/i18nTestSetup.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: ["src/__mocks__/mockedStore.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/require-await": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["src/bufferPolyfill.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlSendTransaction/QrlSendTransactionForContent/QrlSendTransactionForContent.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlSendTransaction/QrlSendTransactionForContent/QrlSendTransactionForContent.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/only-throw-error": "off",
      "@typescript-eslint/unbound-method": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlSignTypedDataV4/PersonalSign/PersonalSign.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlSignTypedDataV4/PersonalSign/PersonalSign.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlSignTypedDataV4/QrlSignTypedDataV4Content/QrlSignTypedDataV4Content.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlSignTypedDataV4/QrlSignTypedDataV4Content/QrlSignTypedDataV4Content.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/SwitchQrlChainContent/SwitchQrlChainContent.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/SwitchQrlChainContent/SwitchQrlChainContent.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/SwitchQrlChainContent/SwitchQrlChainInfo/SwitchQrlChainInfo.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-spread": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/SwitchQrlChainContent/SwitchQrlChainInfo/SwitchQrlChainInfo.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/WatchAssetContent/WatchAssetContent.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/WatchAssetContent/WatchAssetInfo/WatchAssetInfo.tsx",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/WatchAssetContent/WatchAssetVerification/WatchAssetVerification.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/WatchAssetContent/WatchAssetVerification/WatchAssetVerification.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/NewChain/AddEditChain/AddEditChainForm/AddEditChainForm.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-misused-spread": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/NewChain/AddEditChain/AddEditChainForm/AddEditChainForm.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/NewChain/AddEditChain/AddEditChainForm/UrlSelections/AddUrlItem/AddUrlItem.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/NewChain/AddEditChain/AddEditChainForm/UrlSelections/UrlSelections.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/OtherChains/OtherChainItem/OtherChainItem.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-spread": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/OtherChains/OtherChainItem/OtherChainItem.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/OtherChains/OtherChains.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/OtherChains/OtherChains.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Contacts/ContactForm.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Contacts/ContactItem.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Contacts/ContactsPage.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/CreateAccount/AccountCreationSuccess/AccountCreationSuccess.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/CreateAccount/CreateAccount.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/CreateAccount/CreateAccount.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/CreateAccount/MnemonicDisplay/MnemonicWordListing/MnemonicWordListing.tsx",
    ],
    rules: {
      "@typescript-eslint/no-useless-default-assignment": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/DAppConnectivity/ActiveBrowserTab/ActiveBrowserTab.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/DAppConnectivity/ConnectivityWithWallet/DAppConnected/DAppConnected.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/DAppConnectivity/ConnectivityWithWallet/DAppConnected/DAppConnectedAccounts/DAppConnectedAccounts.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/DAppConnectivity/ConnectivityWithWallet/DAppConnected/DAppConnectedAccounts/DAppConnectedAccounts.tsx",
    ],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/DAppConnectivity/ConnectivityWithWallet/DAppConnected/DAppConnectedAccounts/EditDAppConnectedAccounts/EditDAppConnectedAccounts.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/DAppConnectivity/ConnectivityWithWallet/DAppConnected/DAppConnectedAccounts/EditDAppConnectedAccounts/EditDAppConnectedAccounts.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/DAppConnectivity/ConnectivityWithWallet/DAppConnected/DAppConnectedBlockchains/DAppConnectedBlockchains.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/DAppConnectivity/ConnectivityWithWallet/DAppConnected/DAppConnectedBlockchains/DAppConnectedBlockchains.tsx",
    ],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/DAppConnectivity/ConnectivityWithWallet/DAppConnected/DAppConnectedBlockchains/EditDAppConnectedBlockchains/EditDAppConnectedBlockchains.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/DAppConnectivity/ConnectivityWithWallet/DAppConnected/DAppConnectedBlockchains/EditDAppConnectedBlockchains/EditDAppConnectedBlockchains.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/AccountCreateImport.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/AccountCreateImport.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/NFTCollections/NFTCollectionItem/NFTCollectionItem.test.tsx",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/NFTCollections/NFTCollectionItem/NFTCollectionItem.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/NFTCollections/NFTCollections.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/NFTCollections/NFTCollections.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/TokenListItem/TokenListItem.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-spread": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/TokenListItem/TokenListItem.tsx",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/TokenListItem/TokenListItemIcon/TokenListItemIcon.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/ZRC20Tokens/ZRC20Token/ZRC20Token.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/ZRC20Tokens/ZRC20Token/ZRC20Token.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/ZRC20Tokens/ZRC20Tokens.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-misused-spread": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/ZRC20Tokens/ZRC20Tokens.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/Home.tsx",
    ],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/AccountImportSuccess/AccountImportSuccess.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportAccount.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportAccount.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportEncryptedWallet/ImportEncryptedWallet.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportEncryptedWallet/ImportEncryptedWallet.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportHexSeedForm/ImportHexSeedForm.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportHexSeedForm/ImportHexSeedForm.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportMnemonicForm/ImportMnemonicForm.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/NFTGallery/NFTGallery.test.tsx",
    ],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/NFTGallery/NFTGallery.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/NFTGallery/NFTGalleryItem.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/NFTTransfer/NFTTransfer.test.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/NFTTransfer/NFTTransfer.tsx",
    ],
    rules: {
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Receive/Receive.tsx",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Settings/Settings.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Settings/SettingsAbout.tsx",
    ],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Settings/SettingsAppearance.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Settings/SettingsData.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-spread": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Settings/SettingsData.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Settings/SettingsPreferences.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Settings/SettingsSecurity.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
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
    files: ["src/configuration/assetDiscoveryConfig.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/configuration/releaseProfile.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/configuration/releaseProfile.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    files: ["src/crypto/keystoreCrypto.test.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["src/crypto/keystoreCrypto.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/hooks/useCopy.test.tsx"],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/hooks/useUnlockAttemptGate.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: ["src/i18n/index.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: ["src/main.tsx"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["src/scripts/middlewares/appendSenderDataMiddleware.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/scripts/middlewares/blockUnSupportedMethodsMiddleware.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: [
      "src/scripts/middlewares/restrictedMethodsMiddleware.approvalErrors.test.ts",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/scripts/middlewares/unrestrictedMethodsMiddleware.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/scripts/phishing/phishingDetector.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: ["src/scripts/phishing/phishingDetector.ts"],
    rules: {
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    files: ["src/scripts/phishing/qrlPhishingConfig.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/scripts/utils/approvalSlot.test.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
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
    files: ["src/scripts/utils/approvalSurface.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/scripts/utils/boundProvider.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/scripts/utils/boundProvider.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/scripts/utils/dAppAccountNotifications.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/scripts/utils/dAppAccountNotifications.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/scripts/utils/dAppTransactionWatcher.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["src/scripts/utils/dAppTransactionWatcher.ts"],
    rules: {
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/scripts/utils/providerConnectionLifecycle.test.ts"],
    rules: {
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/scripts/utils/providerConnectionLifecycle.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["src/scripts/utils/providerLogger.test.ts"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/scripts/utils/providerLogger.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/scripts/utils/qip55LogFilter.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: ["src/scripts/utils/qip55LogFilter.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
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
    files: [
      "src/scripts/utils/restrictedMethodsMiddlewareUtils.dAppTransactionWatch.test.ts",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/scripts/utils/restrictedMethodsMiddlewareUtils.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["src/scripts/utils/scriptUtils.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    files: ["src/scripts/utils/sidePanelContentBridge.test.ts"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/scripts/utils/sidePanelContentBridge.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/scripts/utils/sidePanelPreference.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/scripts/utils/sidePanelPreference.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/scripts/utils/sidePanelSurface.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/scripts/utils/sidePanelSurface.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/scripts/utils/streamUtils.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/scripts/utils/trustedSender.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["src/scripts/utils/unrestrictedMethodExecutor.test.ts"],
    rules: {
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
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
    files: ["src/scripts/workers/keystoreWorkerPool.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["src/scripts/workers/keystoreWorkerPool.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
    },
  },
  {
    files: ["src/services/ledger/ledgerApdu.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["src/services/ledger/ledgerApdu.ts"],
    rules: {
      "@typescript-eslint/only-throw-error": "off",
    },
  },
  {
    files: ["src/services/ledger/ledgerService.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/services/ledger/ledgerTransport.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: ["src/services/ledger/ledgerTransport.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/services/ledger/speculosTransport.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/stores/accountLabelsStore.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: ["src/stores/accountLabelsStore.ts"],
    rules: {
      "@typescript-eslint/no-dynamic-delete": "off",
    },
  },
  {
    files: ["src/stores/contactsStore.test.ts"],
    rules: {
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: ["src/stores/dAppRequestStore.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/stores/dAppRequestStore.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/stores/dataLifecycle.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["src/stores/hiddenAccountsStore.test.ts"],
    rules: {
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: ["src/stores/hiddenAccountsStore.ts"],
    rules: {
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
    },
  },
  {
    files: ["src/stores/ledgerStore.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/stores/ledgerStore.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: ["src/stores/lockStore.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: ["src/stores/priceStore.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/stores/priceStore.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/stores/qrlStore.amounts.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/stores/qrlStore.balancePolling.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-useless-constructor": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/stores/qrlStore.balanceReactivity.test.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-misused-spread": "off",
      "@typescript-eslint/no-useless-constructor": "off",
    },
  },
  {
    files: ["src/stores/qrlStore.connectionHealth.test.ts"],
    rules: {
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-useless-constructor": "off",
    },
  },
  {
    files: ["src/stores/qrlStore.initialization.test.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/stores/qrlStore.nonce.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/stores/qrlStore.removeAccount.test.ts"],
    rules: {
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-useless-constructor": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/stores/qrlStore.tokenGas.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-useless-constructor": "off",
    },
  },
  {
    files: ["src/stores/qrlStore.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },
  {
    files: ["src/stores/settingsStore.test.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/stores/settingsStore.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["src/stores/transactionHistoryStore.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/stores/transactionHistoryStore.ts"],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: ["src/test-utils/malformed.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
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
  {
    files: ["src/utilities/storageUtil.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
];
// END LINT RATCHET

export default [...baseConfig, ...lintRatchet];
