import { describe, expect, it } from 'vitest';
import type { ListingCard } from './api';
import { groupProjects } from './projects';

const unit = (o: Partial<ListingCard>): ListingCard =>
  ({
    id: Math.random().toString(),
    emirate: 'Dubai',
    community: 'Dubai Hills',
    price: 1_000_000,
    project: null,
    handoverDate: null,
    photos: [],
    ...o,
  }) as ListingCard;

describe('groupProjects', () => {
  it('groups by project, with the lowest price and earliest handover', () => {
    const g = groupProjects([
      unit({ project: 'Vista', price: 2_000_000, handoverDate: '2028-06-30' }),
      unit({ project: 'vista', price: 1_500_000, handoverDate: '2027-12-31' }),
      unit({ project: null }),
    ]);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ name: 'Vista', fromPrice: 1_500_000, handover: '2027-12-31' });
    expect(g[0]!.units).toHaveLength(2);
    expect(g[1]!.name).toBe('Off-plan in Dubai Hills');
  });
});
