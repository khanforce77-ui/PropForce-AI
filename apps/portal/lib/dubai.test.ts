import { describe, expect, it } from 'vitest';
import { communityCount, communityHref, DUBAI_COMMUNITIES, homepageCommunities } from './dubai';

const facets = {
  communities: [
    { emirate: 'Dubai', community: 'Dubai Marina', count: 4 },
    { emirate: 'Dubai', community: 'Al Furjan', count: 2 },
    { emirate: 'Abu Dhabi', community: 'Saadiyat Island', count: 9 },
  ],
};

describe('Dubai communities on the homepage', () => {
  it('links to the clean area page only when the community has listings', () => {
    expect(communityHref('sale', 'Dubai Marina', facets)).toBe('/for-sale/dubai/dubai-marina');
    expect(communityHref('rent', 'Palm Jumeirah', facets)).toBe(
      '/for-rent?community=Palm+Jumeirah',
    );
    expect(communityHref('sale', 'Dubai Marina', null)).toBe('/for-sale?community=Dubai+Marina');
  });

  it('counts only Dubai listings', () => {
    expect(communityCount('Dubai Marina', facets)).toBe(4);
    expect(communityCount('Saadiyat Island', facets)).toBe(0);
  });

  it('puts communities with listings first and never shows other emirates', () => {
    const names = homepageCommunities(facets).map((c) => c.name);
    expect(names.slice(0, 2)).toEqual(['Dubai Marina', 'Al Furjan']);
    expect(names).not.toContain('Saadiyat Island');
    expect(names).toHaveLength(8);
    expect(homepageCommunities(null)).toEqual(DUBAI_COMMUNITIES.slice(0, 8));
  });
});
