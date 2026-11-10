import { Store, openStore } from './db/store.js';
import { getDatabasePath, ensureComicodeHome } from './paths.js';
import type { AppSettings } from './settings.js';
import { seedKnownCatalog } from './providers/service.js';

export interface AppContext {
  store: Store;
  cwd: string;
  settings: AppSettings;
  close: () => void;
}

function ensureSelection(store: Store): void {
  const profiles = store.listProfiles();
  if (profiles.length === 0) return;
  const selectedId = store.getSelectedProfileId();
  const selected = selectedId ? profiles.find((profile) => profile.id === selectedId) : null;
  if (!selected || !selected.enabled) {
    const fallback =
      profiles
        .filter((profile) => profile.enabled)
        .sort((a, b) => (b.lastSuccessAt ?? '').localeCompare(a.lastSuccessAt ?? ''))[0] ??
      profiles[0];
    if (fallback) store.setSelectedProfileId(fallback.id);
  }
}

export function openAppContext(cwd = process.cwd()): AppContext {
  ensureComicodeHome();
  const store = openStore(getDatabasePath());
  seedKnownCatalog(store);
  store.clearExpiredLimits();
  ensureSelection(store);
  return {
    store,
    cwd,
    settings: store.getSettings(),
    close: () => store.close(),
  };
}

export function refreshContextSettings(context: AppContext): void {
  context.settings = context.store.getSettings();
}
