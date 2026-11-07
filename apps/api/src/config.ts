import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const ident = z.string().regex(/^[a-z_][a-z0-9_]*$/i, 'Nama kolom/view tidak valid');
const optIdent = z.union([z.literal('').transform(() => null), ident]).default('').transform((v) => v ?? null);

const Schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().default(3100),
    HOST: z.string().default('127.0.0.1'),
    PUBLIC_ORIGIN: z.string().url(),
    TRUST_PROXY: z.string().default('loopback'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    COOKIE_SECURE: bool.default(true),
    ALLOW_INSECURE_COOKIE: bool.default(false),
    SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).default(480),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).default(12),
    WEB_DIST: z.string().optional(),

    APP_DB_HOST: z.string(),
    APP_DB_PORT: z.coerce.number().int().default(5432),
    APP_DB_NAME: z.string(),
    APP_DB_USER: z.string(),
    APP_DB_PASSWORD: z.string(),
    APP_DB_SSL: bool.default(false),
    APP_DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
    MIGRATE_DB_USER: z.string().optional(),
    MIGRATE_DB_PASSWORD: z.string().optional(),

    CONMAS_DB_HOST: z.string(),
    CONMAS_DB_PORT: z.coerce.number().int().default(5432),
    CONMAS_DB_NAME: z.string(),
    CONMAS_DB_USER: z.string(),
    CONMAS_DB_PASSWORD: z.string(),
    CONMAS_DB_SSL: bool.default(false),
    CONMAS_VIEW: ident.default('view_report_27537'),
    CONMAS_POOL_MAX: z.coerce.number().int().min(1).max(5).default(2),
    CONMAS_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),
    CONMAS_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(600).default(60),
    CONMAS_SOURCE_TIMEZONE_OFFSET: z.string().regex(/^[+-]\d{2}:\d{2}$/).default('+07:00'),
    CONMAS_COL_RECORD_ID: optIdent,
    CONMAS_COL_REV_NO: optIdent,
    CONMAS_COL_DELETED: optIdent,
    CONMAS_COL_UPDATED_AT: optIdent,
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production' && !c.COOKIE_SECURE && !c.ALLOW_INSECURE_COOKIE)
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'COOKIE_SECURE=false di production butuh exception tercatat (ALLOW_INSECURE_COOKIE=true)' });
  });

export type Config = z.infer<typeof Schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = Schema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Konfigurasi tidak valid: ${msg}`);
  }
  return r.data;
}
