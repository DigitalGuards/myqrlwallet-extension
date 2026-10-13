import pluginJs from "@eslint/js";
import pluginJestDom from "eslint-plugin-jest-dom";
import pluginReact from "eslint-plugin-react";
import globals from "globals";
import tseslint from "typescript-eslint";

export const testFiles = [
  "**/*.test.{ts,tsx}",
  "**/__mocks__/**/*.{ts,tsx}",
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
    files: ["src/**/*.{ts,tsx}"],
    ignores: testFiles,
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
    ...tseslint.configs.disableTypeChecked,
    files: ["**/*.{js,mjs,cjs,jsx}"],
  },
  pluginReact.configs.flat.recommended,
  {
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      "react/react-in-jsx-scope": "off",
      "react/display-name": "off",
      "react/prop-types": "off",
      "react/jsx-filename-extension": [
        1,
        { extensions: [".js", ".jsx", ".ts", ".tsx"] },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  pluginJestDom.configs["flat/recommended"],
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: testFiles,
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
          "ts-expect-error": "allow-with-description",
          minimumDescriptionLength: 10,
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
      // Defensive runtime checks on typed wire input are deliberate.
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    files: testFiles,
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["tailwind.config.js", "postcss.config.js"],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

// Existing production lint debt. Entries may only be removed.
// Regenerate with node scripts/lint-ratchet.mjs after fixing a file/rule pair.
// BEGIN LINT RATCHET
export const lintRatchet = [
  {
    files: ["src/components/QrlWeb3Wallet/RouteMonitor/RouteMonitor.tsx"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequest.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/AddQrlChainContent/AddQrlChainContent.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/AddQrlChainContent/AddQrlChainInfo/AddQrlChainDetails/AddQrlChainDetails.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/AddQrlChainContent/AddQrlChainInfo/AddQrlChainDetails/CurrencyImagePreload/CurrencyImagePreload.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/prefer-promise-reject-errors": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlPqSign/QrlPqSign.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlRequestAccount/QrlRequestAccountContent/QrlRequestAccountAccountSelection/QrlRequestAccountAccountSelection.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlRequestAccount/QrlRequestAccountContent/QrlRequestAccountBlockchainSelection/QrlRequestAccountBlockchainSelection.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlRequestAccount/QrlRequestAccountContent/QrlRequestAccountContent.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlSendTransaction/CalldataSummary/CalldataSummary.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlSendTransaction/QrlSendTransaction.tsx",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlSendTransaction/QrlSendTransactionForContent/QrlSendTransactionForContent.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-floating-promises": "off",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlSignTypedDataV4/PersonalSign/PersonalSign.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlSignTypedDataV4/QrlSignTypedDataV4Content/QrlSignTypedDataV4Content.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-base-to-string": "off",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestWebsite.tsx",
    ],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/PermissionRequiredContent.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/SwitchQrlChainContent/SwitchQrlChainInfo/SwitchQrlChainInfo.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/WatchAssetContent/WatchAssetVerification/WatchAssetVerification.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/LockPassword.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/LockPasswordCheck/LockPasswordCheck.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/Onboarding/AddOrImportAccount/AddOrImportAccount.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/Onboarding/LockPasswordSetup/LockPasswordSetup.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/Onboarding/Onboarding.tsx",
    ],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/Onboarding/OnboardingCompleted/OnboardingCompleted.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Lock/LockPassword/Onboarding/Welcome/Welcome.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["src/components/QrlWeb3Wallet/ScreenLoader/ScreenLoader.tsx"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/AddressDisclosure.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Shared/BackButton/BackButton.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Shared/ResetWalletDialog/ResetWalletDialog.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Shared/SeedBackup/SeedBackup.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Shared/SessionPasswordPrompt/SessionPasswordPrompt.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/AccountList/AccountList.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/AccountList/ActiveAccount/ActiveAccount.tsx",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/AccountList/OtherAccounts/OtherAccounts.tsx",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/ChainIcon/ChainIcon.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/NewChain/AddEditChain/AddEditChain.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ChainConnectivity/OtherChains/OtherChainItem/OtherChainItem.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/unbound-method": "off",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/AccountCreateImport.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
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
      "@typescript-eslint/unbound-method": "off",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/TokenListItem/TokenListItem.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/ZRC20Tokens/ZRC20Token/ZRC20Token.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/unbound-method": "off",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportAccount.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportEncryptedWallet/ImportEncryptedWallet.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportHexSeedForm/ImportHexSeedForm.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportMnemonicForm/ImportMnemonicForm.tsx",
    ],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportToken/DiscoveredTokens/DiscoveredTokens.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportToken/TokenImportSuccess/TokenImportSuccess.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/NFTGallery/NFTGallery.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
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
      "@typescript-eslint/unbound-method": "off",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TokenTransfer/GasFeeNotice/GasFeeNotice.tsx",
    ],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/unbound-method": "off",
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
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: [
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TokenTransfer/RecipientPicker/RecipientPicker.tsx",
    ],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
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
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
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
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off",
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
      "src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/QrlWeb3WalletMoreOptions/QrlWeb3WalletMoreOptions.tsx",
    ],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
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
      "@typescript-eslint/no-unnecessary-template-expression": "off",
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
    files: ["src/crypto/keystoreCrypto.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/functions/mnemonicHelper.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  {
    files: ["src/functions/pqSigning/typedData.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
  {
    files: ["src/functions/transactionOutcome.ts"],
    rules: {
      "@typescript-eslint/no-base-to-string": "off",
    },
  },
  {
    files: ["src/functions/walletBackupImport.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/functions/walletFileImport.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: ["src/functions/withTimeout.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
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
    files: ["src/scripts/contentScript.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["src/scripts/inPageScript.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["src/scripts/lockManager/keystoreParams.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/scripts/lockManager/lockManager.ts"],
    rules: {
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  {
    files: ["src/scripts/middlewares/blockUnSupportedMethodsMiddleware.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["src/scripts/middlewares/restrictedMethodsMiddleware.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["src/scripts/middlewares/unrestrictedMethodsMiddleware.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: ["src/scripts/phishing/phishingDetector.ts"],
    rules: {
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
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
    files: ["src/scripts/serviceWorker.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/scripts/utils/approvalSurface.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["src/scripts/utils/boundProvider.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/scripts/utils/dAppAccountNotifications.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/scripts/utils/dAppTransactionWatcher.ts"],
    rules: {
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
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
    files: ["src/scripts/utils/providerLogger.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/scripts/utils/qip55LogFilter.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/scripts/utils/restrictedMethodsMiddlewareUtils.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
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
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    files: ["src/scripts/utils/sidePanelContentBridge.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/scripts/utils/sidePanelPreference.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["src/scripts/utils/sidePanelSurface.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-deprecated": "off",
    },
  },
  {
    files: ["src/scripts/utils/streamUtils.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/scripts/utils/unrestrictedMethodExecutor.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  {
    files: ["src/scripts/workers/keystoreWorkerPool.ts"],
    rules: {
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
    },
  },
  {
    files: ["src/services/assetDiscovery.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
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
    files: ["src/services/onChainHistory.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/stores/accountLabelsStore.ts"],
    rules: {
      "@typescript-eslint/no-dynamic-delete": "off",
    },
  },
  {
    files: ["src/stores/dAppRequestStore.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/require-await": "off",
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
    files: ["src/stores/ledgerStore.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: ["src/stores/lockStore.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: ["src/stores/priceStore.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/stores/qrlStore.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
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
    files: ["src/stores/settingsStore.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: ["src/stores/transactionHistoryStore.ts"],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
    },
  },
  {
    files: ["src/utilities/ipfsUtil.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    files: ["src/utilities/legacyWalletData.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
  {
    files: ["src/utilities/profileStorage.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
  {
    files: ["src/utilities/qrnsResolver.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["src/utilities/stringUtil.ts"],
    rules: {
      "@typescript-eslint/no-extraneous-class": "off",
    },
  },
  {
    files: ["src/utilities/unlockAttemptLimiter.ts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
];
// END LINT RATCHET

export default [...baseConfig, ...lintRatchet];
