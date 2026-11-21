import { describe, expect, it } from 'vitest';
import { photoUrl } from './photos';

describe('photoUrl', () => {
  it('serves from the portal domain and keeps the version', () => {
    const p = { id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427', version: 'a b', width: 1, height: 1 };
    expect(photoUrl(p, 'thumb')).toBe(
      '/media/listings/1b4e28ba-2fa1-41d2-883f-0016d3cca427/thumb?v=a%20b',
    );
  });
});
