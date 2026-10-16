// App bootstrap: runtime config, Supabase session, store and sync wiring.

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { openStore } from './db';
import { Store } from './store';
import { SyncEngine } from './sync';

export interface RuntimeConfig {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  vapidPublicKey: string | null;
  /** Server env variables that are not set yet. */
  missing: string[];
  /** True when /api/config could not be reached (offline or no server). */
  fromCache?: boolean;
}

const CONFIG_KEY = 'okuma:config';

export async function loadConfig(): Promise<RuntimeConfig> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('/api/config', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error(String(res.status));
    const cfg = (await res.json()) as RuntimeConfig;
    safeStorage.set(CONFIG_KEY, JSON.stringify(cfg));
    return cfg;
  } catch {
    const cached = safeStorage.get(CONFIG_KEY);
    if (cached) return { ...(JSON.parse(cached) as RuntimeConfig), fromCache: true };
    return { supabaseUrl: null, supabaseAnonKey: null, vapidPublicKey: null, missing: [], fromCache: true };
  }
}

export interface Runtime {
  config: RuntimeConfig;
  store: Store;
  supabase: SupabaseClient | null;
  session: Session | null;
  sync: SyncEngine | null;
}

export async function boot(): Promise<Runtime> {
  const [config, db] = await Promise.all([loadConfig(), openStore()]);
  const store = new Store(db);
  await store.load();

  let supabase: SupabaseClient | null = null;
  let session: Session | null = null;
  let sync: SyncEngine | null = null;
  if (config.supabaseUrl && config.supabaseAnonKey) {
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    });
    session = (await supabase.auth.getSession()).data.session;
    if (session) {
      sync = new SyncEngine(store, supabase, session.user.id);
      startSyncLoop(sync);
    }
  }
  return { config, store, supabase, session, sync };
}

function startSyncLoop(sync: SyncEngine) {
  const kick = () => {
    void sync.sync();
    void sync.touchActive();
  };
  kick();
  // iOS needs a moment to bring the network back after the app returns to the foreground.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(kick, 1000);
  });
  window.addEventListener('online', () => void sync.sync());
  setInterval(() => {
    if (document.visibilityState === 'visible') void sync.sync();
  }, 60_000);
}

/** localStorage can throw (private mode, blocked storage); never let that break the app. */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};
