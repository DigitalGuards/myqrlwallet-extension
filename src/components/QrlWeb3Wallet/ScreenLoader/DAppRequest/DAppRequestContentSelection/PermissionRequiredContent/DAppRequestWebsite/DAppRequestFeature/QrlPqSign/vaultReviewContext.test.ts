import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import StorageUtil from "@/utilities/storageUtil";
import type { StoredToken } from "@/utilities/storageGuards";
import { vaultTestAddress } from "@/functions/pqSigning/__tests__/quantaVaultFixtures";
import { useVaultTokens } from "./vaultReviewContext";

const token = {
  address: vaultTestAddress,
  symbol: "LOCAL",
  decimals: 6,
  image: "",
};
const request = { method: "qrl_signTypedData" };
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("pins the metadata read to the active chain and discards it if that chain changes during the read", async () => {
  const active = vi
    .spyOn(StorageUtil, "getActiveBlockChain")
    .mockResolvedValueOnce({ chainId: "0x1" })
    .mockResolvedValueOnce({ chainId: "0x2" });
  const tokens = vi
    .spyOn(StorageUtil, "getTokenContractsList")
    .mockResolvedValue([token]);
  const { result } = renderHook(() =>
    useVaultTokens(vaultTestAddress, "0x1", request, true),
  );
  await waitFor(() => {
    expect(active).toHaveBeenCalledTimes(2);
  });
  expect(tokens).toHaveBeenCalledExactlyOnceWith(vaultTestAddress, "0x1");
  expect(result.current).toEqual([]);
});

it("discards a late token read when another side panel request replaces its owner", async () => {
  vi.spyOn(StorageUtil, "getActiveBlockChain").mockResolvedValue({
    chainId: "0x1",
  });
  let finish: ((tokens: StoredToken[]) => void) | undefined;
  const pending = new Promise<StoredToken[]>((resolve) => {
    finish = resolve;
  });
  const tokens = vi
    .spyOn(StorageUtil, "getTokenContractsList")
    .mockReturnValueOnce(pending)
    .mockResolvedValue([]);
  const { result, rerender } = renderHook(
    ({ owner }) => useVaultTokens(owner, "0x1", request, true),
    { initialProps: { owner: vaultTestAddress } },
  );
  await waitFor(() => {
    expect(tokens).toHaveBeenCalledTimes(1);
  });
  rerender({ owner: `Q${"22".repeat(64)}` });
  await act(async () => {
    finish?.([token]);
    await pending;
  });
  expect(result.current).toEqual([]);
});

it("clears a previous owner's loaded metadata while the next read is pending", async () => {
  vi.spyOn(StorageUtil, "getActiveBlockChain").mockResolvedValue({
    chainId: "0x1",
  });
  let finish: ((tokens: StoredToken[]) => void) | undefined;
  const pending = new Promise<StoredToken[]>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(StorageUtil, "getTokenContractsList")
    .mockResolvedValueOnce([token])
    .mockReturnValueOnce(pending);
  const { result, rerender } = renderHook(
    ({ owner }) => useVaultTokens(owner, "0x1", request, true),
    { initialProps: { owner: vaultTestAddress } },
  );
  await waitFor(() => {
    expect(result.current).toEqual([token]);
  });
  rerender({ owner: `Q${"22".repeat(64)}` });
  expect(result.current).toEqual([]);
  await act(async () => {
    finish?.([]);
    await pending;
  });
});
