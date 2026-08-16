import { useCallback, useEffect, useState } from 'react';

// Small helper for lists we keep in the browser (wishlist, recently viewed).
// These are per-device by design — no account or database round-trip needed,
// so they work for signed-out shoppers too.
export function useLocalList(key: string, max = 50) {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* storage full or blocked */ }
  }, [key, ids]);

  // Keep other tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || e.newValue == null) return;
      try { setIds(JSON.parse(e.newValue) as string[]); } catch { /* ignore bad payload */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  const has = useCallback((id: string) => ids.includes(id), [ids]);

  const toggle = useCallback((id: string) => {
    setIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [id, ...prev].slice(0, max)));
  }, [max]);

  // Most recent first, no duplicates.
  const push = useCallback((id: string) => {
    setIds(prev => [id, ...prev.filter(x => x !== id)].slice(0, max));
  }, [max]);

  const remove = useCallback((id: string) => setIds(prev => prev.filter(x => x !== id)), []);
  const clear = useCallback(() => setIds([]), []);

  return { ids, has, toggle, push, remove, clear };
}
