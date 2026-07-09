import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { ROUTES } from "@/router/router";
import {
  discoverNftCollections,
  discoverTokens,
} from "@/services/assetDiscovery";
import { useStore } from "@/stores/store";
import { cva } from "class-variance-authority";
import {
  Download,
  History,
  Image,
  Logs,
  Plus,
  Send,
  Sparkles,
  Usb,
} from "lucide-react";
import { observer } from "mobx-react-lite";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ActiveAccountDisplay from "./ActiveAccountDisplay/ActiveAccountDisplay";
import TokensCardContent from "./ActiveAccountDisplay/TokensCardContent/TokensCardContent";
import NFTCollections from "./ActiveAccountDisplay/TokensCardContent/NFTCollections/NFTCollections";
import { useEffect, useState } from "react";
import StorageUtil from "@/utilities/storageUtil";
import { ZRC_20_ITEMS_DISPLAY_LIMIT } from "@/constants/zrc20Token";

const tokensClasses = cva("w-full", {
  variants: {
    hasTokensPreference: {
      true: ["order-first"],
      false: ["order-2"],
    },
  },
  defaultVariants: {
    hasTokensPreference: false,
  },
});

const nftClasses = cva("w-full", {
  variants: {
    hasTokensPreference: {
      true: ["order-first"],
      false: ["order-3"],
    },
  },
  defaultVariants: {
    hasTokensPreference: false,
  },
});

const addAccountsClasses = cva("w-full", {
  variants: {
    hasAccountCreationPreference: {
      true: ["order-first"],
      false: ["order-4"],
    },
  },
  defaultVariants: {
    hasAccountCreationPreference: false,
  },
});

const AccountCreateImport = observer(() => {
  const { t } = useTranslation();
  const { state } = useLocation();
  const { qrlStore } = useStore();
  const { activeAccount, qrlConnection } = qrlStore;
  const { accountAddress } = activeAccount;
  const { blockchain } = qrlConnection;

  const hasActiveAccount = !!accountAddress;
  const hasAccountCreationPreference = !!state?.hasAccountCreationPreference;
  const hasTokensPreference = !!state?.hasTokensPreference;

  const [tokenContractsList, setTokenContractsList] = useState<string[]>([]);
  const [discoveredTokenCount, setDiscoveredTokenCount] = useState(0);
  const [discoveredCollectionCount, setDiscoveredCollectionCount] =
    useState(0);

  useEffect(() => {
    (async () => {
      const storedTokens =
        await StorageUtil.getTokenContractsList(accountAddress);
      setTokenContractsList(storedTokens.map((token) => token?.address));
    })();
  }, [accountAddress]);

  // Explorer-side asset discovery: count what the explorer sees on this
  // address but the user has not imported yet, and surface a hint above
  // the import buttons. Adding still requires an explicit pick on the
  // import screens.
  useEffect(() => {
    let cancelled = false;
    setDiscoveredTokenCount(0);
    setDiscoveredCollectionCount(0);
    (async () => {
      if (!accountAddress) return;
      const [tokens, storedTokens, collections, storedCollections] =
        await Promise.all([
          discoverTokens(accountAddress, blockchain.chainId),
          StorageUtil.getTokenContractsList(accountAddress),
          discoverNftCollections(accountAddress, blockchain.chainId),
          StorageUtil.getNFTCollectionsList(accountAddress),
        ]);
      if (cancelled) return;
      const existingTokens = new Set(
        storedTokens.map((token) => token.address.toLowerCase()),
      );
      const existingCollections = new Set(
        storedCollections.map((collection) =>
          collection.address.toLowerCase(),
        ),
      );
      setDiscoveredTokenCount(
        tokens.filter(
          (token) => !existingTokens.has(token.address.toLowerCase()),
        ).length,
      );
      setDiscoveredCollectionCount(
        collections.filter(
          (collection) =>
            !existingCollections.has(collection.address.toLowerCase()),
        ).length,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [accountAddress, blockchain]);

  return (
    <div className="flex animate-appear-in flex-col gap-8">
      {hasActiveAccount && (
        <>
          <Card className="order-1 w-full">
            <CardHeader>
              <CardTitle>{t('home.activeAccount')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ActiveAccountDisplay />
            </CardContent>
            <CardFooter className="flex-col gap-2">
              <Link
                className="w-full"
                to={ROUTES.TOKEN_TRANSFER}
                state={{ shouldStartFresh: true }}
              >
                <Button className="w-full" type="button" variant="secondary">
                  <Send className="mr-2 h-4 w-4" />
                  {t('home.sendQuanta')}
                </Button>
              </Link>
              <Link className="w-full" to={ROUTES.TRANSACTION_HISTORY}>
                <Button className="w-full" type="button" variant="outline">
                  <History className="mr-2 h-4 w-4" />
                  {t('home.transactionHistory')}
                </Button>
              </Link>
            </CardFooter>
          </Card>
          <Card className={tokensClasses({ hasTokensPreference })}>
            <CardHeader>
              <CardTitle>{t('home.tokens')}</CardTitle>
            </CardHeader>
            <CardContent>
              <TokensCardContent />
            </CardContent>
            <CardFooter className="flex-col gap-4">
              {discoveredTokenCount > 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 shrink-0 text-secondary" />
                  {t("discovery.tokensFound", {
                    count: discoveredTokenCount,
                  })}
                </div>
              )}
              <Link className="w-full" to={ROUTES.IMPORT_TOKEN}>
                <Button className="w-full" type="button">
                  {discoveredTokenCount > 0 ? (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      {t("discovery.reviewAndAdd")}
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      {t("home.importToken")}
                    </>
                  )}
                </Button>
              </Link>
              {tokenContractsList.length > ZRC_20_ITEMS_DISPLAY_LIMIT && (
                <Link className="w-full" to={ROUTES.ALL_ZRC_20_TOKENS}>
                  <Button className="w-full" type="button" variant="outline">
                    <Logs className="mr-2 h-4 w-4" />
                    {t('home.viewAllTokens')}
                  </Button>
                </Link>
              )}
            </CardFooter>
          </Card>
          <Card className={nftClasses({ hasTokensPreference })}>
            <CardHeader>
              <CardTitle>{t('home.nftCollections')}</CardTitle>
            </CardHeader>
            <CardContent>
              <NFTCollections />
            </CardContent>
            <CardFooter className="flex-col gap-4">
              {discoveredCollectionCount > 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 shrink-0 text-secondary" />
                  {t("discovery.collectionsFound", {
                    count: discoveredCollectionCount,
                  })}
                </div>
              )}
              <Link className="w-full" to={ROUTES.IMPORT_NFT_COLLECTION}>
                <Button className="w-full" type="button">
                  {discoveredCollectionCount > 0 ? (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      {t("discovery.reviewAndAdd")}
                    </>
                  ) : (
                    <>
                      <Image className="mr-2 h-4 w-4" />
                      {t("nft.importButton")}
                    </>
                  )}
                </Button>
              </Link>
            </CardFooter>
          </Card>
        </>
      )}
      <Card className={addAccountsClasses({ hasAccountCreationPreference })}>
        <CardHeader>
          <CardTitle>{t('home.addAccounts')}</CardTitle>
          <CardDescription>
            {t('home.addAccountsDescription')}
          </CardDescription>
        </CardHeader>
        <CardFooter className="flex-col gap-4">
          <Link className="w-full" to={ROUTES.CREATE_ACCOUNT}>
            <Button className="w-full" type="button">
              <Plus className="mr-2 h-4 w-4" />
              {t('home.createAccount')}
            </Button>
          </Link>
          <Link className="w-full" to={ROUTES.IMPORT_ACCOUNT}>
            <Button className="w-full" type="button" variant="outline">
              <Download className="mr-2 h-4 w-4" />
              {t('home.importAccount')}
            </Button>
          </Link>
          <Link className="w-full" to={ROUTES.IMPORT_LEDGER}>
            <Button className="w-full" type="button" variant="outline">
              <Usb className="mr-2 h-4 w-4" />
              {t('home.connectLedger')}
            </Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
});

export default AccountCreateImport;
