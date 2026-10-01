import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/UI/tabs";
import { useStore } from "@/stores/store";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import QrlRequestAccountAccountSelection from "./QrlRequestAccountAccountSelection/QrlRequestAccountAccountSelection";
import QrlRequestAccountBlockchainSelection from "./QrlRequestAccountBlockchainSelection/QrlRequestAccountBlockchainSelection";
import StorageUtil from "@/utilities/storageUtil";
import { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";

const QrlRequestAccountContent = observer(() => {
  const { t } = useTranslation();
  const { dAppRequestStore, qrlStore } = useStore();
  const { addToResponseData, setCanProceed, dAppRequestData } =
    dAppRequestStore;

  // The origin that actually sent this request. The active browser tab is a
  // different thing: the approval surface outlives tab switches, and an
  // iframe request comes from an origin the tab bar never shows. Ticking
  // the active tab's grants here could pre-select accounts the requesting
  // site was never granted, one click away from being handed to it.
  const requestOrigin = (() => {
    try {
      const origin = new URL(
        dAppRequestData?.requestData?.senderData?.url ?? "",
      ).origin;
      return origin === "null" ? "" : origin;
    } catch {
      return "";
    }
  })();

  const [isLoadingBlockchains, setIsLoadingBlockchains] = useState(true);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [allBlockchains, setAllBlockchains] = useState<BlockchainDataType[]>(
    [],
  );
  const [selectedBlockchains, setSelectedBlockchains] = useState<
    BlockchainDataType[]
  >([]);

  const activeAddress = qrlStore.activeAccount.accountAddress;
  const activeChainId = qrlStore.qrlConnection.blockchain.chainId;

  useEffect(() => {
    (async () => {
      const allBlockchains = await StorageUtil.getAllBlockChains();
      const grantedToRequestOrigin = requestOrigin
        ? await StorageUtil.getDAppsConnectedAccountsData(requestOrigin)
        : undefined;

      // First connect for this site: preselect the active account and the
      // wallet's current chain so the default approval is a single click.
      // Sites with prior grants keep exactly what they had.
      const storedAccounts = grantedToRequestOrigin?.accounts ?? [];
      setSelectedAccounts(
        storedAccounts.length
          ? storedAccounts
          : activeAddress
            ? [activeAddress]
            : [],
      );

      const storedBlockchains = grantedToRequestOrigin?.blockchains ?? [];
      const activeBlockchain = allBlockchains.find(
        (blockchain) => blockchain.chainId === activeChainId,
      );
      setAllBlockchains(allBlockchains);
      setSelectedBlockchains(
        storedBlockchains.length
          ? storedBlockchains
          : activeBlockchain
            ? [activeBlockchain]
            : [],
      );
      setIsLoadingBlockchains(false);
    })();
    // The wallet is often still booting when this screen mounts, so the
    // active account and chain arrive after the first pass. Both are in the
    // dependency list so the defaults land once they do.
  }, [requestOrigin, activeAddress, activeChainId]);

  useEffect(() => {
    addToResponseData({
      accounts: selectedAccounts,
      blockchains: selectedBlockchains,
    });
    setCanProceed(!!selectedAccounts.length && !!selectedBlockchains.length);
  }, [selectedAccounts, selectedBlockchains]);

  const onAccountSelection = (selectedAccount: string, checked: boolean) => {
    let updatedAccounts = selectedAccounts;
    if (checked) {
      updatedAccounts = Array.from(
        new Set([...updatedAccounts, selectedAccount]),
      );
    } else {
      updatedAccounts = updatedAccounts.filter(
        (account) => account !== selectedAccount,
      );
    }
    setSelectedAccounts(updatedAccounts);
  };

  const onBlockchainSelection = (
    selectedBlockchain: BlockchainDataType,
    checked: boolean,
  ) => {
    let updatedBlockchains = selectedBlockchains;
    if (checked) {
      updatedBlockchains = Array.from(
        new Set([...updatedBlockchains, selectedBlockchain]),
      );
    } else {
      updatedBlockchains = updatedBlockchains.filter(
        (blockchain) => blockchain.chainId !== selectedBlockchain.chainId,
      );
    }
    setSelectedBlockchains(updatedBlockchains);
  };

  return (
    <Tabs defaultValue="accounts">
      <TabsList className="w-full">
        <TabsTrigger
          value="accounts"
          className="w-full data-[state=active]:text-secondary"
        >
          {t("dapp.requestAccount.tabAccounts")}
        </TabsTrigger>
        <TabsTrigger
          value="blockchains"
          className="w-full data-[state=active]:text-secondary"
        >
          {t("dapp.requestAccount.tabBlockchains")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="accounts" className="rounded-md p-2">
        <QrlRequestAccountAccountSelection
          selectedAccounts={selectedAccounts}
          onAccountSelection={onAccountSelection}
        />
      </TabsContent>
      <TabsContent value="blockchains" className="rounded-md p-2">
        <QrlRequestAccountBlockchainSelection
          isLoading={isLoadingBlockchains}
          allBlockchains={allBlockchains}
          selectedBlockchains={selectedBlockchains}
          onBlockchainSelection={onBlockchainSelection}
        />
      </TabsContent>
    </Tabs>
  );
});

export default QrlRequestAccountContent;
