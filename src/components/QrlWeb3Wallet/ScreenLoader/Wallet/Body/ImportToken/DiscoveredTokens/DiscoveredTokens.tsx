import { Button } from "@/components/UI/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/UI/Card";
import { Checkbox } from "@/components/UI/Checkbox";
import { Label } from "@/components/UI/Label";
import { ROUTES } from "@/router/router";
import {
  DiscoveredToken,
  discoverTokens,
} from "@/services/assetDiscovery";
import { useStore } from "@/stores/store";
import StorageUtil from "@/utilities/storageUtil";
import { Loader, Sparkles } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

/**
 * Explorer-discovered tokens the active account owns but has not imported
 * yet, offered as a review-and-add picker above the manual import form.
 * Renders nothing when the explorer sees no unimported tokens.
 */
const DiscoveredTokens = observer(() => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { qrlStore } = useStore();
  const { activeAccount, qrlConnection } = qrlStore;
  const { accountAddress } = activeAccount;
  const { blockchain } = qrlConnection;

  const [pendingTokens, setPendingTokens] = useState<DiscoveredToken[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSelected(new Set());
    (async () => {
      if (!accountAddress) return;
      const [discovered, stored] = await Promise.all([
        discoverTokens(accountAddress, blockchain.chainId),
        StorageUtil.getTokenContractsList(accountAddress),
      ]);
      if (cancelled) return;
      const existing = new Set(
        stored.map((token) => token.address.toLowerCase()),
      );
      setPendingTokens(
        discovered.filter(
          (token) => !existing.has(token.address.toLowerCase()),
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
      const picks = pendingTokens.filter((token) =>
        selected.has(token.address.toLowerCase()),
      );
      for (const pick of picks) {
        await StorageUtil.setTokenContractsList(accountAddress, {
          address: pick.address,
          symbol: pick.symbol,
          decimals: pick.decimals,
          image: "",
        });
      }
      navigate(ROUTES.HOME);
    } finally {
      setIsAdding(false);
    }
  };

  if (pendingTokens.length === 0) return null;

  return (
    <Card className="mb-8 w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-secondary" />
          {t("discovery.discoveredTokens", { count: pendingTokens.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("discovery.pickerHint")}
        </p>
        <ul className="flex max-h-60 flex-col gap-2 overflow-y-auto">
          {pendingTokens.map((token) => {
            const key = token.address.toLowerCase();
            return (
              <li
                key={key}
                className="flex items-center gap-3 rounded-md border bg-background p-2"
              >
                <Checkbox
                  id={`discovered-token-${key}`}
                  checked={selected.has(key)}
                  onCheckedChange={() => toggleSelection(token.address)}
                  disabled={isAdding}
                />
                <Label
                  htmlFor={`discovered-token-${key}`}
                  className="flex flex-1 cursor-pointer flex-col gap-0.5"
                >
                  <span className="text-sm font-medium">
                    {token.name}{" "}
                    <span className="text-muted-foreground">
                      ({token.symbol})
                    </span>
                  </span>
                  <span className="break-all font-mono text-xs text-muted-foreground">
                    {token.address}
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

export default DiscoveredTokens;
