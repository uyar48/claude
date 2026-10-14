// Asks the service worker to cache the media of a lesson, for offline use.

export interface CacheReport {
  done: number;
  failed: number;
  total: number;
}

let seq = 0;

export async function cacheMedia(urls: string[]): Promise<CacheReport> {
  if (!('serviceWorker' in navigator) || urls.length === 0) return { done: 0, failed: 0, total: urls.length };
  const reg = await navigator.serviceWorker.ready;
  const target = reg.active;
  if (!target) return { done: 0, failed: urls.length, total: urls.length };
  const id = `c${++seq}`;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onMsg);
      resolve({ done: 0, failed: urls.length, total: urls.length });
    }, 60_000);
    function onMsg(e: MessageEvent) {
      if (e.data?.type !== 'cache-media-done' || e.data.id !== id) return;
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('message', onMsg);
      resolve({ done: e.data.done, failed: e.data.failed, total: e.data.total });
    }
    navigator.serviceWorker.addEventListener('message', onMsg);
    target.postMessage({ type: 'cache-media', id, urls });
  });
}
