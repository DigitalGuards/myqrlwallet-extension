import { useEffect, useState } from "react";
import type {
  DAppRequestType,
  TokenContractType,
} from "@/scripts/middlewares/middlewareTypes";
import StorageUtil from "@/utilities/storageUtil";
import { tokenView } from "@/utilities/storageViews";
import { vaultUint } from "@/functions/pqSigning/quantaVault";

export function vaultChainNumber(value: unknown): bigint | undefined {
  try {
    return vaultUint(value);
  } catch {
    return undefined;
  }
}

export function pageOrigin(url?: string): string | undefined {
  try {
    const origin = new URL(url ?? "").origin;
    return origin === "null" ? undefined : origin;
  } catch {
    return undefined;
  }
}

export function escapeVisualControls(value: string): string {
  return value.replace(
    /[\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Imported symbols and decimals only. Every storage read stays on the active chain. */
export function useVaultTokens(
  owner: string,
  activeChainId: string | undefined,
  request: DAppRequestType | undefined,
  enabled: boolean,
): readonly TokenContractType[] {
  const [snapshot, setSnapshot] = useState<{
    owner: string;
    request: DAppRequestType | undefined;
    chainId: string;
    tokens: TokenContractType[];
  }>();
  useEffect(() => {
    let current = true;
    const readTokens = async () => {
      if (!enabled || !owner || !activeChainId) return;
      const chain = vaultChainNumber(activeChainId);
      if (chain === undefined) return;
      try {
        const before = await StorageUtil.getActiveBlockChain();
        if (vaultChainNumber(before.chainId) !== chain) return;
        const tokens = await StorageUtil.getTokenContractsList(
          owner,
          before.chainId,
        );
        const after = await StorageUtil.getActiveBlockChain();
        if (!current || vaultChainNumber(after.chainId) !== chain) return;
        setSnapshot({
          owner,
          request,
          chainId: activeChainId,
          tokens: tokens.map(tokenView),
        });
      } catch {
        // Missing or unreadable metadata leaves the exact base units visible.
        if (current) setSnapshot(undefined);
      }
    };
    void readTokens();
    return () => {
      current = false;
    };
  }, [owner, activeChainId, request, enabled]);
  return enabled &&
    snapshot?.owner === owner &&
    snapshot.request === request &&
    snapshot.chainId === activeChainId
    ? snapshot.tokens
    : [];
}
