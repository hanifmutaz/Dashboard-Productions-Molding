import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const migrationsDirectory = fileURLToPath(new URL('../../../../database/migrations/', import.meta.url));
export const migrationFiles = () => readdirSync(migrationsDirectory).filter((file) => /^\d{3}_.+\.sql$/.test(file)).sort();
