import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import type { Repos } from '../db/repos.js';
import type { Logger } from '../logger.js';
import type { ConmasSource } from '../modules/conmas/source.js';
import { adminRoutes } from '../modules/admin/routes.js';
import { authRoutes } from '../modules/auth/routes.js';
import { healthRoutes } from '../modules/health/routes.js';
import { kioskRoutes } from '../modules/kiosk/routes.js';
import { masterDataRoutes } from '../modules/masterdata/routes.js';
import { metricsRoutes, type MetricsCache } from '../modules/metrics/routes.js';
import { settingsRoutes } from '../modules/settings/routes.js';
import { notFound } from './errors.js';
import { auditor, authenticate, cookies, csrf, errorHandler, requestId, securityHeaders } from './middleware.js';

export interface AppDeps {
  repos: Repos;
  conmas: ConmasSource;
  log: Logger;
  publicOrigin: string;
  cookieSecure: boolean;
  idleMinutes: number;
  absoluteHours: number;
  trustProxy: string | boolean;
  tzOffsetMinutes: number;
  version: string;
  webDist?: string;
}

export function createApp(d: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', d.trustProxy);
  app.use(requestId, securityHeaders, cookies);
  app.use((req, res, next) => {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      if (!req.path.startsWith('/api')) return;
      d.log.info({ requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, ms: Number(process.hrtime.bigint() - t0) / 1e6 }, 'http');
    });
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use(authenticate(d.repos, { idleMinutes: d.idleMinutes, secure: d.cookieSecure }));
  api.use(csrf(d.publicOrigin));
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const audit = auditor(d.repos, d.log);
  const cache: MetricsCache = { settings: null, categories: null };
  const invalidate = () => {
    cache.settings = null;
    cache.categories = null;
    d.conmas.invalidate();
  };
  api.use(healthRoutes(d.repos, d.conmas, d.version));
  api.use(authRoutes(d.repos, audit, { secure: d.cookieSecure, absoluteHours: d.absoluteHours }));
  api.use(settingsRoutes(d.repos, audit, invalidate));
  api.use(masterDataRoutes(d.repos, d.conmas, audit, invalidate));
  api.use(adminRoutes(d.repos, audit));
  api.use(kioskRoutes(d.repos, audit, d.cookieSecure));
  api.use(metricsRoutes(d.repos, d.conmas, cache, d.tzOffsetMinutes));
  api.use(() => {
    throw notFound('Endpoint');
  });
  app.use('/api', api);

  if (d.webDist && existsSync(path.join(d.webDist, 'index.html'))) {
    const dist = d.webDist;
    app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, p) => p.includes(`${path.sep}assets${path.sep}`) && res.setHeader('Cache-Control', 'public, max-age=31536000, immutable') }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }
  app.use(errorHandler(d.log));
  return app;
}
