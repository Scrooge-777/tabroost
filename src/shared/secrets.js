/**
 * Sync secrets (GitHub token + passphrase) live outside settings so they never reach
 * exports, backups or the settings broadcast. By default they are kept in
 * storage.session only (gone when the browser closes); "remember" also writes them
 * to storage.local so background sync survives restarts.
 */

import { STORAGE_KEYS, LEGACY_SECRET_SETTING_KEYS } from './constants.js';
import { storage } from './storage.js';

function clean(value) {
  return {
    token: typeof value?.token === 'string' ? value.token : '',
    passphrase: typeof value?.passphrase === 'string' ? value.passphrase : ''
  };
}

export async function getSyncSecrets() {
  const [session, local] = await Promise.all([
    storage.getSession(STORAGE_KEYS.SYNC_SECRETS),
    storage.getLocal(STORAGE_KEYS.SYNC_SECRETS)
  ]);
  const fromSession = clean(session[STORAGE_KEYS.SYNC_SECRETS]);
  const fromLocal = clean(local[STORAGE_KEYS.SYNC_SECRETS]);
  return {
    token: fromSession.token || fromLocal.token,
    passphrase: fromSession.passphrase || fromLocal.passphrase
  };
}

/**
 * Merge a partial update (undefined fields are kept, '' clears) and persist it
 * to the area implied by `remember`.
 */
export async function setSyncSecrets(partial = {}, remember = false) {
  const current = await getSyncSecrets();
  const next = { ...current };
  if (typeof partial.token === 'string') next.token = partial.token.trim();
  if (typeof partial.passphrase === 'string') next.passphrase = partial.passphrase;

  await storage.setSession({ [STORAGE_KEYS.SYNC_SECRETS]: next });
  if (remember) {
    await storage.setLocal({ [STORAGE_KEYS.SYNC_SECRETS]: next });
  } else {
    await storage.removeLocal(STORAGE_KEYS.SYNC_SECRETS);
  }
  return next;
}

/**
 * Apply the "remember on this device" choice to secrets that already exist
 */
export async function applyRememberChoice(remember) {
  const current = await getSyncSecrets();
  if (current.token || current.passphrase) await setSyncSecrets({}, remember);
  else if (!remember) await storage.removeLocal(STORAGE_KEYS.SYNC_SECRETS);
}

export async function clearSyncSecrets() {
  await storage.removeSession(STORAGE_KEYS.SYNC_SECRETS);
  await storage.removeLocal(STORAGE_KEYS.SYNC_SECRETS);
}

/**
 * Older versions kept the secrets inside settings. Move them out once; they stay
 * remembered so existing sync setups keep working.
 */
export async function migrateLegacySecrets() {
  const raw = await storage.getLocal(STORAGE_KEYS.SETTINGS);
  const settings = raw[STORAGE_KEYS.SETTINGS];
  if (!settings || typeof settings !== 'object') return false;
  if (!LEGACY_SECRET_SETTING_KEYS.some((k) => k in settings)) return false;

  const token = typeof settings.syncGistToken === 'string' ? settings.syncGistToken : '';
  const passphrase = typeof settings.syncPassphrase === 'string' ? settings.syncPassphrase : '';
  const rest = { ...settings };
  for (const k of LEGACY_SECRET_SETTING_KEYS) delete rest[k];

  if (token || passphrase) {
    rest.syncRememberSecrets = true;
    await setSyncSecrets({ token, passphrase }, true);
  }
  await storage.setLocal({ [STORAGE_KEYS.SETTINGS]: rest });
  return true;
}
