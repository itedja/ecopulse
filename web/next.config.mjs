import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// Google sign-in returns to "/?code=…&tab=reports" (that address is on Supabase's allow-list).
// The map now lives at /app, so those visits are forwarded there with the query string intact,
// before any page code runs. Same for sign-in errors.
const toApp = (key) => ({ source: '/', has: [{ type: 'query', key }], destination: '/app', permanent: false });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The repo root also has a package-lock.json (for the data scripts); this app lives in /web.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  async redirects() {
    return [toApp('code'), toApp('tab'), toApp('error'), toApp('error_description')];
  },
};
export default nextConfig;
