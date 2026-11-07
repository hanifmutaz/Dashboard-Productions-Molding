import { Router } from 'express';
import type { Repos } from '../../db/repos.js';
import type { ConmasSource } from '../conmas/source.js';

/** ADR-023: liveness is public and minimal; readiness reveals only coarse status (no hostnames, no SQL). */
export function healthRoutes(repos: Repos, conmas: ConmasSource, version: string): Router {
  const r = Router();
  r.get('/health', (_req, res) => {
    res.json({ status: 'ok', version, uptimeSeconds: Math.round(process.uptime()) });
  });
  r.get('/health/ready', async (req, res) => {
    const appDb = await repos.ping().then(() => true, () => false);
    const source = await conmas.health();
    const ready = appDb;
    const detailed = req.principal?.kind === 'user';
    res.status(ready ? 200 : 503).json({
      status: ready ? (source.ok ? 'ready' : 'degraded') : 'not-ready',
      appDb: appDb ? 'up' : 'down',
      conmas: source.ok ? 'up' : 'unavailable',
      ...(detailed && !source.ok ? { conmasReason: source.reason, missingColumns: source.missingColumns } : {}),
    });
  });
  return r;
}
