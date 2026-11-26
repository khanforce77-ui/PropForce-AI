/**
 * Campaign tags (utm_source, utm_medium, utm_campaign) from the link a visitor arrived by. Kept
 * for the browser session so an enquiry made a few pages later is still attributed.
 */
const KEY = 'pf_utm';

export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
}

export function readUtm(): Utm | undefined {
  if (typeof window === 'undefined') return undefined;
  const q = new URLSearchParams(window.location.search);
  const fresh: Utm = {};
  for (const k of ['source', 'medium', 'campaign'] as const) {
    const v = q.get(`utm_${k}`)?.trim().slice(0, 100);
    if (v) fresh[k] = v;
  }
  try {
    if (fresh.source) {
      sessionStorage.setItem(KEY, JSON.stringify(fresh));
      return fresh;
    }
    const saved = sessionStorage.getItem(KEY);
    return saved ? (JSON.parse(saved) as Utm) : undefined;
  } catch {
    return fresh.source ? fresh : undefined;
  }
}
