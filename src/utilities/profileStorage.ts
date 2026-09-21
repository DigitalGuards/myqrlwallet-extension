import browser from "webextension-polyfill";
import { V3_STORAGE_PREFIX } from "@/configuration/releaseProfile";

export const profileStorageKey = (key: string): string =>
  `${V3_STORAGE_PREFIX}${key}`;

export const createProfileStorage = (area: browser.Storage.StorageArea) => ({
  async get(
    key: string,
  ): Promise<Awaited<ReturnType<browser.Storage.StorageArea["get"]>>> {
    const result = await area.get(profileStorageKey(key));
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
    const values = await area.get(null);
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
