/**
 * The auto-lock timeout applied when the user has never chosen one: the
 * settings observable's initial value before storage loads (settingsStore.ts),
 * and the service worker's fallback when persisted settings are unreadable
 * or predate this field (lockManager.ts). One constant so the three
 * previously-duplicated `?? 15` literals cannot drift apart.
 */
export const DEFAULT_AUTO_LOCK_MINUTES = 15;
