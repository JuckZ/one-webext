import { resolve } from 'node:path';
import { bgCyan, black } from 'kolorist';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const port = parseInt(process.env.PORT || '') || 3303;
export const r = (...args: string[]) => resolve(__dirname, '..', ...args);
export const isDev = process.env.NODE_ENV !== 'production';

export function log(name: string, message: string) {
  console.log(black(bgCyan(` ${name} `)), message);
}
