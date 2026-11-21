'use client';

import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'propforce:saved-listings';
const MAX = 100;
const listeners = new Set<() => void>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '[]';
  } catch {
    return '[]';
  }
}

/** Saved listing ids, newest first. Kept in this browser only; no account needed. */
export function parseSaved(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

export function toggleSaved(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [id, ...list].slice(0, MAX);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function useSaved() {
  const raw = useSyncExternalStore(subscribe, read, () => '[]');
  const ids = parseSaved(raw);
  const toggle = useCallback((id: string) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(toggleSaved(parseSaved(read()), id)));
    } catch {
      /* storage blocked (private mode): nothing to keep */
    }
    listeners.forEach((l) => l());
  }, []);
  return { ids, toggle };
}
