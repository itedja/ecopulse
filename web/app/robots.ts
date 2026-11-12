import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/signin-done'] }],
    sitemap: 'https://www.ecopulseindonesia.com/sitemap.xml',
    host: 'https://www.ecopulseindonesia.com',
  };
}
