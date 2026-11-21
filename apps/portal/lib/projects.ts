import type { ListingCard } from './api';

export interface ProjectGroup {
  key: string;
  name: string;
  community: string | null;
  emirate: string;
  fromPrice: number | null;
  handover: string | null;
  units: ListingCard[];
}

/** Off-plan listings grouped into projects (or by community, when the agency set no project). */
export function groupProjects(listings: ListingCard[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const l of listings) {
    const name = l.project ?? `Off-plan in ${l.community ?? l.emirate}`;
    const key = `${l.emirate}|${name.toLowerCase()}`;
    const g = groups.get(key) ?? {
      key,
      name,
      community: l.community,
      emirate: l.emirate,
      fromPrice: null,
      handover: null,
      units: [],
    };
    g.units.push(l);
    if (l.price != null && (g.fromPrice == null || l.price < g.fromPrice)) g.fromPrice = l.price;
    if (l.handoverDate && (!g.handover || l.handoverDate < g.handover)) g.handover = l.handoverDate;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.units.length - a.units.length);
}
