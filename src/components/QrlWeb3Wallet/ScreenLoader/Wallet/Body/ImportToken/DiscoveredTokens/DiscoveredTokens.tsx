import { Button } from "@/components/UI/Button";
import { Checkbox } from "@/components/UI/Checkbox";
import { Label } from "@/components/UI/Label";
import AddressFingerprint from "@/components/QrlWeb3Wallet/ScreenLoader/Shared/AddressDisplay/AddressFingerprint";
import { ROUTES } from "@/router/router";
import {
  DiscoveredToken,
  discoverTokens,
  MAX_DISCOVERED_TOKENS,
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
 * yet, offered as a pick-and-add list above the manual import form, the
 * way the web wallet's Add token dialog does it. Renders nothing when the
 * explorer sees no unimported tokens.
 *
 * Every pick is read from the chain before it is stored, and the stored
 * symbol and decimals come from that read. The explorer only decides what
 * the list offers, so a token whose contract does not answer as ZRC-20
 * never lands in the wallet.
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
  // Names of picks whose chain read failed on the last add. They stay
  // listed and unimported; one line names them all.
  const [failedNames, setFailedNames] = useState<string[]>([]);
  // The explorer response is capped, so a heavily airdropped account sees
  // only part of what it holds. Saying so beats a list that silently ends.
  const [wasTruncated, setWasTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSelected(new Set());
    setFailedNames([]);
    const loadTokens = async () => {
      if (!accountAddress) return;
      const [discovered, stored] = await Promise.all([
        discoverTokens(accountAddress, blockchain.chainId),
        StorageUtil.getTokenContractsList(accountAddress),
      ]);
      if (cancelled) return;
      const existing = new Set(
        stored.map((token) => token.address.toLowerCase()),
      );
      setWasTruncated(discovered.length >= MAX_DISCOVERED_TOKENS);
      setPendingTokens(
        discovered.filter(
          (token) => !existing.has(token.address.toLowerCase()),
        ),
      );
    };
    loadTokens().catch((error: unknown) => {
      console.error("[DiscoveredTokens] Failed to load tokens:", error);
    });
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
    if (selected.size === 0 || isAdding) return;
    setIsAdding(true);
    setFailedNames([]);
    try {
      const picks = pendingTokens.filter((token) =>
        selected.has(token.address.toLowerCase()),
      );
      // A read that throws counts as a failed read for that pick alone.
      const reads = await Promise.all(
        picks.map(async (pick) => ({
          pick,
          details: await qrlStore
            .getZrc20TokenDetails(pick.address)
            .catch((error: unknown) => {
              console.error("[DiscoveredTokens] Failed to read token:", error);
              return { token: undefined, error: "read failed" };
            }),
        })),
      );
      const added = new Set<string>();
      const failed: string[] = [];
      // One write at a time: each write rewrites the whole stored token
      // record, so parallel writes would drop tokens.
      for (const { pick, details } of reads) {
        const { token, error } = details;
        if (error || !token) {
          failed.push(pick.name || pick.symbol || pick.address);
          continue;
        }
        try {
          await StorageUtil.setTokenContractsList(accountAddress, {
            address: pick.address,
            symbol: token.symbol,
            decimals: parseInt(token.decimals.toString()),
            image: "",
          });
        } catch (writeError: unknown) {
          console.error("[DiscoveredTokens] Failed to save token:", writeError);
          failed.push(pick.name || pick.symbol || pick.address);
          continue;
        }
        added.add(pick.address.toLowerCase());
      }
      if (failed.length === 0) {
        await navigate(ROUTES.HOME);
        return;
      }
      setPendingTokens((prev) =>
        prev.filter((token) => !added.has(token.address.toLowerCase())),
      );
      setSelected(
        (prev) => new Set([...prev].filter((key) => !added.has(key))),
      );
      setFailedNames(failed);
    } finally {
      setIsAdding(false);
    }
  };

  if (pendingTokens.length === 0) return null;

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="h-4 w-4 shrink-0 text-secondary" />
        {t("discovery.discoveredTokens", { count: pendingTokens.length })}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("discovery.pickerHint")}
      </p>
      {wasTruncated && (
        <p className="text-xs text-muted-foreground">
          {t("discovery.truncated", { limit: MAX_DISCOVERED_TOKENS })}
        </p>
      )}
      {failedNames.length > 0 && (
        <p
          className="text-sm font-medium text-destructive [overflow-wrap:anywhere]"
          role="alert"
        >
          {t("discovery.tokenAddFailed", {
            count: failedNames.length,
            names: failedNames.join(", "),
          })}
        </p>
      )}
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
                name={`discoveredToken-${key}`}
                checked={selected.has(key)}
                onCheckedChange={() => {
                  toggleSelection(token.address);
                }}
                disabled={isAdding}
              />
              <Label
                htmlFor={`discovered-token-${key}`}
                className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5"
              >
                {/* A token name with no spaces (a spam token's calling
                    card) otherwise runs past the 360px panel edge. */}
                <span className="break-words text-sm font-medium">
                  {token.name}{" "}
                  <span className="text-muted-foreground">
                    ({token.symbol})
                  </span>
                </span>
                <AddressFingerprint
                  address={token.address}
                  className="text-xs text-muted-foreground"
                />
              </Label>
            </li>
          );
        })}
      </ul>
      <Button
        type="button"
        className="h-auto min-h-10 w-full whitespace-normal py-2"
        disabled={selected.size === 0 || isAdding}
        onClick={() => {
          addSelected().catch((error: unknown) => {
            console.error("[DiscoveredTokens] Failed to import tokens:", error);
          });
        }}
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
    </div>
  );
});

export default DiscoveredTokens;
