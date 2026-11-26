import { Router, type RequestHandler } from 'express';
import type pg from 'pg';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { PERMISSIONS } from '@mpd/contracts';
import { requirePermission } from '../../http/middleware.js';

export interface RequestSample { ms: number; status: number }
export function summarizeRequests(samples: readonly RequestSample[]) {
  const times = samples.map(s => s.ms).sort((a,b) => a-b);
  return {
    count: times.length,
    errors: samples.filter(s => s.status >= 500).length,
    clientErrors: samples.filter(s => s.status >= 400 && s.status < 500).length,
    avgMs: times.length ? Math.round(times.reduce((a,b) => a+b,0)/times.length) : null,
    p95Ms: times.length ? Math.round(times[Math.ceil(times.length*.95)-1]!) : null,
  };
}

const Evidence = z.object({
  backupAt: z.iso.datetime().nullable(),
  restoreTestAt: z.iso.datetime().nullable(),
  restorePassed: z.boolean().nullable(),
  backupSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
});
async function backupEvidence() {
  const file = process.env.MPD_BACKUP_EVIDENCE_FILE;
  if (!file) return { state: 'not-configured' as const, evidence: null };
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > 65536) throw new Error('Invalid evidence file');
    const evidence = Evidence.parse(JSON.parse(await readFile(file,'utf8')));
    const ageHours = evidence.backupAt ? (Date.now()-Date.parse(evidence.backupAt))/3600000 : null;
    const state = ageHours === null || ageHours < 0 ? 'unknown' : ageHours > 24 ? 'stale' : 'reported';
    return { state, evidence };
  } catch {
    return { state: 'unavailable' as const, evidence: null };
  }
}

export function createSystemMonitor(pool?: pg.Pool) {
  let lastBucket = -1, lastRetentionDay = -1;
  const samples: RequestSample[] = [];
  const observe: RequestHandler = (req,res,next) => {
    if (!req.path.startsWith('/api/') || req.path.startsWith('/api/health') || req.path === '/api/system/monitor') { next(); return; }
    const start = process.hrtime.bigint();
    res.once('finish', () => {
      samples.push({ ms: Number(process.hrtime.bigint()-start)/1e6, status: res.statusCode });
      if (samples.length > 500) samples.shift();
      const bucket = Math.floor(Date.now()/300000)*300000;
      if (pool && bucket !== lastBucket) {
        lastBucket=bucket;
        const snapshot={...summarizeRequests(samples),rssMb:Math.round(process.memoryUsage().rss/1048576),uptimeSeconds:Math.round(process.uptime())};
        void pool.query('INSERT INTO md_performance_snapshot(bucket,metrics) VALUES($1,$2::jsonb) ON CONFLICT(bucket) DO UPDATE SET metrics=EXCLUDED.metrics',[new Date(bucket).toISOString(),JSON.stringify(snapshot)]).then(async()=>{
          const day=Math.floor(bucket/86400000);
          if(day!==lastRetentionDay){lastRetentionDay=day;await pool.query("DELETE FROM md_performance_snapshot WHERE bucket<now()-interval '90 days'");}
        }).catch(()=>undefined);
      }
    });
    next();
  };
  const routes = Router();
  routes.get('/system/performance-history', requirePermission(PERMISSIONS.viewSettings), async (_req,res) => {
    res.json(pool ? (await pool.query('SELECT bucket,metrics FROM md_performance_snapshot ORDER BY bucket DESC LIMIT 288')).rows : []);
  });
  routes.get('/system/monitor', requirePermission(PERMISSIONS.viewSettings), async (_req,res) => {
    const mem = process.memoryUsage();
    res.json({ ...summarizeRequests(samples), uptimeSeconds: Math.round(process.uptime()), rssMb: Math.round(mem.rss/1048576), heapMb: Math.round(mem.heapUsed/1048576), backup: await backupEvidence() });
  });
  return { observe, routes };
}
