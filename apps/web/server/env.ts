import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const webServerDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(webServerDirectory, '..');

config({ path: resolve(webDirectory, '.env') });
config({ path: resolve(webDirectory, '../api/.env') });
