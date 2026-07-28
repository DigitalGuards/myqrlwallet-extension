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
import {
  Download,
  History,
  Image,
  Logs,
  Plus,
  QrCode,
  Send,
  Sparkles,
  Usb,
} from "lucide-react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ActiveAccountDisplay from "./ActiveAccountDisplay/ActiveAccountDisplay";
import TokensCardContent from "./ActiveAccountDisplay/TokensCardContent/TokensCardContent";
import NFTCollections from "./ActiveAccountDisplay/TokensCardContent/NFTCollections/NFTCollections";
import { useEffect, useState } from "react";
import StorageUtil from "@/utilities/storageUtil";
import { ZRC_20_ITEMS_DISPLAY_LIMIT } from "@/constants/zrc20Token";
import { NFT_ITEMS_DISPLAY_LIMIT } from "@/constants/nftToken";
import { cn } from "@/utilities/stylingUtil";

const AccountCreateImport = observer(() => {
  const { t } = useTranslation();
  const { qrlStore } = useStore();
  const { activeAccount, qrlConnection } = qrlStore;
  const { accountAddress } = activeAccount;
  const { blockchain } = qrlConnection;

  const hasActiveAccount = !!accountAddress;

  const [tokenContractsList, setTokenContractsList] = useState<string[]>([]);
  const [nftCollectionsCount, setNftCollectionsCount] = useState(0);
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
    <div className="page-enter flex flex-col gap-8">
      {hasActiveAccount && (
        <>
          <Card className="surface-ember relative w-full overflow-hidden [background:linear-gradient(180deg,hsl(var(--primary)/0.06),transparent_46%),hsl(var(--card)/0.45)]">
            <div className="relative z-10">
              <CardHeader>
                <CardTitle>{t('home.activeAccount')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ActiveAccountDisplay />
              </CardContent>
              <CardFooter className="gap-2">
                <Link
                  className="flex-1"
                  to={ROUTES.TOKEN_TRANSFER}
                  state={{ shouldStartFresh: true }}
                >
                  <Button className="w-full" type="button">
                    <Send className="mr-2 h-4 w-4" />
                    {t('home.send')}
                  </Button>
                </Link>
                <Link className="flex-1" to={ROUTES.TRANSACTION_HISTORY}>
                  <Button className="w-full" type="button" variant="outline">
                    <History className="mr-2 h-4 w-4" />
                    {t('home.history')}
                  </Button>
                </Link>
                <Link className="flex-1" to={ROUTES.RECEIVE}>
                  <Button className="w-full" type="button" variant="secondary">
                    <QrCode className="mr-2 h-4 w-4" />
                    {t('home.receive')}
                  </Button>
                </Link>
              </CardFooter>
            </div>
          </Card>
          <Card className="w-full">
            <CardHeader>
              <CardTitle>{t('home.tokens')}</CardTitle>
            </CardHeader>
            {/* hidden (not unmounted) when empty so the list still fetches;
                an empty CardContent otherwise doubles the header gap */}
            <CardContent
              className={cn(tokenContractsList.length === 0 && "hidden")}
            >
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
          <Card className="w-full">
            <CardHeader>
              <CardTitle>{t('home.nftCollections')}</CardTitle>
            </CardHeader>
            <CardContent className={cn(nftCollectionsCount === 0 && "hidden")}>
              <NFTCollections onCountChange={setNftCollectionsCount} />
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
              {nftCollectionsCount > NFT_ITEMS_DISPLAY_LIMIT && (
                <Link className="w-full" to={ROUTES.ALL_NFT_COLLECTIONS}>
                  <Button className="w-full" type="button" variant="outline">
                    <Logs className="mr-2 h-4 w-4" />
                    {t("home.viewAllNftCollections")}
                  </Button>
                </Link>
              )}
            </CardFooter>
          </Card>
        </>
      )}
      <Card className="w-full">
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
