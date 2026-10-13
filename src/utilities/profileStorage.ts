import browser from "webextension-polyfill";
import { V3_STORAGE_PREFIX } from "@/configuration/releaseProfile";
import { isRecord } from "@/services/explorerGuards";

export const profileStorageKey = (key: string): string =>
  `${V3_STORAGE_PREFIX}${key}`;

export const createProfileStorage = (area: browser.Storage.StorageArea) => ({
  async get(
    key: string,
  ): Promise<Awaited<ReturnType<browser.Storage.StorageArea["get"]>>> {
    const result: unknown = await area.get(profileStorageKey(key));
    if (!isRecord(result)) throw new Error("Invalid browser storage response");
    return Object.prototype.hasOwnProperty.call(result, profileStorageKey(key))
      ? { [key]: result[profileStorageKey(key)] }
      : {};
  },
  async set(values: Record<string, unknown>): Promise<void> {
    await area.set(
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          profileStorageKey(key),
          value,
        ]),
      ),
    );
  },
  async remove(key: string): Promise<void> {
    await area.remove(profileStorageKey(key));
  },
  async clear(): Promise<void> {
    const values: unknown = await area.get(null);
    if (!isRecord(values)) throw new Error("Invalid browser storage response");
    const keys = Object.keys(values).filter((key) =>
      key.startsWith(V3_STORAGE_PREFIX),
    );
    if (keys.length) await area.remove(keys);
  },
});

export const walletLocalStorage = createProfileStorage(browser.storage.local);
export const walletSessionStorage = createProfileStorage(
  browser.storage.session,
);
