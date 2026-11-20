import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/config';

export default function robots(): MetadataRoute.Robots {
  // Staging and previews must not be indexed; set PORTAL_ALLOW_INDEXING=true on the live domain.
  if (process.env.PORTAL_ALLOW_INDEXING !== 'true') {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/go/', '/search'] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
