import { Button } from "@/components/UI/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { Checkbox } from "@/components/UI/Checkbox";
import { Label } from "@/components/UI/Label";
import { ROUTES } from "@/router/router";
import {
  DiscoveredNFTCollection,
  discoverNftCollections,
} from "@/services/assetDiscovery";
import { useStore } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import { Loader, Sparkles } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

/**
 * Explorer-discovered NFT collections the active account owns but has not
 * imported yet, offered as a review-and-add picker above the manual import
 * form. Renders nothing when the explorer sees no unimported collections.
 */
const DiscoveredNFTCollections = observer(() => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { qrlStore } = useStore();
  const { activeAccount, qrlConnection } = qrlStore;
  const { accountAddress } = activeAccount;
  const { blockchain } = qrlConnection;

  const [pendingCollections, setPendingCollections] = useState<
    DiscoveredNFTCollection[]
  >([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSelected(new Set());
    (async () => {
      if (!accountAddress) return;
      const [discovered, stored] = await Promise.all([
        discoverNftCollections(accountAddress, blockchain.chainId),
        StorageUtil.getNFTCollectionsList(accountAddress),
      ]);
      if (cancelled) return;
      const existing = new Set(
        stored.map((collection) => collection.address.toLowerCase()),
      );
      setPendingCollections(
        discovered.filter(
          (collection) => !existing.has(collection.address.toLowerCase()),
        ),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [accountAddress, blockchain]);

  const toggleSelection = (address: string) => {
    const key = address.toLowerCase();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addSelected = async () => {
    if (selected.size === 0) return;
    setIsAdding(true);
    try {
      const picks = pendingCollections.filter((collection) =>
        selected.has(collection.address.toLowerCase()),
      );
      for (const pick of picks) {
        await StorageUtil.setNFTCollectionsList(accountAddress, {
          address: pick.address,
          name: pick.name,
          symbol: pick.symbol,
          standard: pick.standard,
          image: "",
        });
      }
      navigate(ROUTES.HOME);
    } finally {
      setIsAdding(false);
    }
  };

  if (pendingCollections.length === 0) return null;

  return (
    <Card className="mb-8 w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-secondary" />
          {t("discovery.discoveredCollections", {
            count: pendingCollections.length,
          })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("discovery.pickerHint")}
        </p>
        <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
          {pendingCollections.map((collection) => {
            const key = collection.address.toLowerCase();
            return (
              <li
                key={key}
                className="flex items-center gap-3 rounded-md border bg-background p-2"
              >
                <Checkbox
                  id={`discovered-collection-${key}`}
                  checked={selected.has(key)}
                  onCheckedChange={() => toggleSelection(collection.address)}
                  disabled={isAdding}
                />
                <Label
                  htmlFor={`discovered-collection-${key}`}
                  className="flex flex-1 cursor-pointer flex-col gap-0.5"
                >
                  <span className="text-sm font-medium">
                    {collection.name || t("discovery.unknownCollection")}{" "}
                    {collection.symbol && (
                      <span className="text-muted-foreground">
                        ({collection.symbol})
                      </span>
                    )}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {t("discovery.itemCount", {
                        count: collection.tokenCount,
                      })}
                    </span>
                    {collection.standard === "ZRC1155" && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ZRC-1155
                      </span>
                    )}
                  </span>
                  <span className="break-all font-mono text-xs text-muted-foreground">
                    {collection.address}
                  </span>
                </Label>
              </li>
            );
          })}
        </ul>
        <Button
          type="button"
          className="w-full"
          disabled={selected.size === 0 || isAdding}
          onClick={addSelected}
        >
          {isAdding ? (
            <>
              <Loader className="mr-2 h-4 w-4 animate-spin" />
              {t("discovery.adding")}
            </>
          ) : (
            t("discovery.addSelected", { count: selected.size })
          )}
        </Button>
      </CardContent>
    </Card>
  );
});

export default DiscoveredNFTCollections;
