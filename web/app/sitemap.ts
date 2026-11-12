import type { MetadataRoute } from 'next';

const SITE = 'https://www.ecopulseindonesia.com';

// Pages Google should read. The data on them changes all day, hence 'hourly'.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE}/`, lastModified: now, changeFrequency: 'hourly', priority: 1 },
    { url: `${SITE}/app`, lastModified: now, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ];
}
