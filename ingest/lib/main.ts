import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// True when this file was started directly (npm run ...), false when imported by tests.
export const isMain = (metaUrl: string) =>
  !!process.argv[1] && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
