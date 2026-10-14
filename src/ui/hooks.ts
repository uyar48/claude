import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { Runtime } from '../data/runtime';
import type { AppState } from '../data/store';

export const RuntimeContext = createContext<Runtime | null>(null);

export function useRuntime(): Runtime {
  const rt = useContext(RuntimeContext);
  if (!rt) throw new Error('Runtime missing');
  return rt;
}

export function useAppState(): AppState {
  const { store } = useRuntime();
  return useSyncExternalStore(store.subscribe, store.getState);
}

/** Current time, refreshed every `ms` (lets "today" roll over at midnight). */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    const onVis = () => document.visibilityState === 'visible' && setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ms]);
  return now;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
