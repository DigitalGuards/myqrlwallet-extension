/**
 * Detection of pre-v3 wallet data left behind in the UNPREFIXED storage keys.
 *
 * QIP-55 moved the extension onto 64-byte addresses and namespaced every
 * storage key with V3_STORAGE_PREFIX (see profileStorage), so a browser
 * profile that ran a v2 build keeps its earlier records next to the v3 ones
 * under their original bare key names. The onboarding notice that explains
 * this is only honest when such a record is actually there, hence a PRESENCE
 * check: this module looks at array lengths only, it never decrypts or
 * inspects an envelope, so no ciphertext, address or KDF parameter is read.
 *
 * A clean install has no unprefixed keys at all. An empty container is not
 * enough on its own either: a v2 user who removed every account leaves the
 * keys behind with nothing left to recover, and telling them to import a
 * backup they do not have would be noise.
 */
import browser from "webextension-polyfill";

// The bare v2 key names, spelled out here so this stays readable next to a
// v2 storage dump. They deliberately do not go through profileStorage: that
// helper exists to add the v3 prefix these keys must not carry.
const LEGACY_KEYSTORES_KEY = "KEYSTORES";
const LEGACY_ACCOUNTS_KEY = "ACCOUNTS";
const LEGACY_ALL_ACCOUNTS_KEY = "ALL_ACCOUNTS";

/** v2 persisted keystores as a JSON-encoded array under a single key. */
const hasLegacyKeystores = (stored: unknown): boolean => {
  if (typeof stored !== "string") return false;
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
};

/** v2 persisted its address list at ACCOUNTS.ALL_ACCOUNTS. */
const hasLegacyAccounts = (stored: unknown): boolean => {
  if (typeof stored !== "object" || stored === null) return false;
  const allAccounts = (stored as Record<string, unknown>)[
    LEGACY_ALL_ACCOUNTS_KEY
  ];
  return Array.isArray(allAccounts) && allAccounts.length > 0;
};

/**
 * True when this browser profile still holds at least one v2 wallet record:
 * a v2 keystore, or a v2 address in the v2 account list. Never throws: an
 * unreadable storage area counts as "nothing to say", because an onboarding
 * notice is not worth a broken welcome screen.
 */
export const hasLegacyWalletData = async (): Promise<boolean> => {
  try {
    const stored = await browser.storage.local.get([
      LEGACY_KEYSTORES_KEY,
      LEGACY_ACCOUNTS_KEY,
    ]);
    return (
      hasLegacyKeystores(stored?.[LEGACY_KEYSTORES_KEY]) ||
      hasLegacyAccounts(stored?.[LEGACY_ACCOUNTS_KEY])
    );
  } catch {
    return false;
  }
};
