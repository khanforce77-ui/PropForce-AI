import type { ListingPhoto } from './api';

export const photoUrl = (p: ListingPhoto, variant: 'display' | 'thumb') =>
  `/media/listings/${p.id}/${variant}?v=${encodeURIComponent(p.version)}`;
