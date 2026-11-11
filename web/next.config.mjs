import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The repo root also has a package-lock.json (for the data scripts); this app lives in /web.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};
export default nextConfig;
