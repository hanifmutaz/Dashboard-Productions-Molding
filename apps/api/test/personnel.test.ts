import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type pg from 'pg';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type MachineDetailView } from '@mpd/contracts';
import { createApp } from '../src/http/app.js';
import { KIOSK_COOKIE, sha256 } from '../src/http/middleware.js';
import { HEADER_COLUMNS, HOUR_BLOCKS } from '../src/modules/conmas/fieldMap.generated.js';
import { createConmasSource, normalizeRow } from '../src/modules/conmas/source.js';
import { downConmas, memoryRepos } from './memory.js';

const log = pino({ level: 'silent' });
const date = '2026-11-03';
const config = {
  view: 'v', tzOffset: '+07:00', cacheTtlSeconds: 0,
  cols: { recordId: 'rid', revNo: 'rev', deleted: 'del', updatedAt: 'upd' },
  personnelNames: { leader: 'cluster_1_15_t', cell: 'cluster_1_16_t', technician: 'cluster_1_33_t', operator: 'cluster_1_34_t' },
};
const row = {
  [HEADER_COLUMNS.productionDate]: date,
  [HEADER_COLUMNS.machineNo]: '27',
  [HEADER_COLUMNS.shift]: 'S2',
  [HEADER_COLUMNS.leaderNik]: ' 00123 ',
  [HEADER_COLUMNS.cellLeaderNik]: '00124',
  [HEADER_COLUMNS.technicianNik]: '00125',
  [HEADER_COLUMNS.operatorNik]: '00126',
  cluster_1_15_t: ' Leader Sample ',
  cluster_1_16_t: 'Cell Sample',
  cluster_1_33_t: 'Technician Sample',
  cluster_1_34_t: 'Operator Sample',
  rid: '1', rev: '1', del: '0',
};

describe('Machine Detail personnel', () => {
  it('selects the name columns that exist without making the rest mandatory', async () => {
    const available = [...Object.values(HEADER_COLUMNS), ...Object.values(config.cols), config.personnelNames.leader,
      ...HOUR_BLOCKS.flatMap((b) => [b.label, ...b.slots.flatMap((slot) => Object.values(slot) as string[])])];
    const queries: string[] = [];
    const pool = {
      query: (sql: string) => {
        queries.push(sql);
        if (sql.includes('FROM pg_attribute')) return Promise.resolve({ rows: available.map((column_name) => ({ column_name })) });
        return Promise.resolve({ rowCount: 1, rows: [row] });
      },
    } as unknown as pg.Pool;
    const source = createConmasSource(pool, config, log);
    const detail = await source.records(date, date, '27');
    expect(queries[1]).toContain('"' + config.personnelNames.leader + '"');
    expect(queries[1]).not.toContain(config.personnelNames.cell);
    expect(detail.records[0]).toMatchObject({ personnel: { leader: '00123' }, personnelNames: { leader: 'Leader Sample' } });
    expect(detail.records[0]?.personnelNames?.cell).toBeUndefined();
    await expect(source.health()).resolves.toEqual({ ok: true });
    await source.records(date, date);
    expect(queries[2]).not.toContain(config.personnelNames.leader);
  });

  it('pairs the name and photo with the latest shift and authorizes the photo by machine', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mpd-test-photos-'));
    try {
      await writeFile(path.join(dir, '00123.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ligAAAAASUVORK5CYII=', 'base64'));
      const ctx = await memoryRepos();
      await ctx.repos.settings.update({ ...DEFAULT_SETTINGS, md: { ...DEFAULT_SETTINGS.md, pic: true } }, 0, 'test');
      const credential = 'fixture-kiosk-token';
      ctx.repos.kiosks.byTokenHash = (hash) => Promise.resolve(hash === sha256(credential) ? {
        id: 'paired', name: 'Fixture iPad', machineNo: '27', tokenHash: hash,
        createdAt: date, lastSeenAt: null, revokedAt: null,
      } : null);
      const latest = normalizeRow(row, config)!;
      const earlier = normalizeRow({ ...row, [HEADER_COLUMNS.shift]: 'S1', [HEADER_COLUMNS.leaderNik]: '00999', cluster_1_15_t: 'Earlier leader' }, config)!;
      const app = createApp({
        repos: ctx.repos, log, publicOrigin: 'http://localhost:5173', cookieSecure: false,
        idleMinutes: 60, absoluteHours: 12, trustProxy: false, tzOffsetMinutes: 420, version: 't', employeePhotoDir: dir,
        conmas: { ...downConmas, adjacentDates: () => Promise.resolve({ prev: null, next: null }),
          records: () => Promise.resolve({ records: [latest, earlier], invalidRows: 0, duplicatesDropped: 0 }) },
      });
      const kiosk = request(app);
      const auth = KIOSK_COOKIE + '=' + credential;
      const detail = await kiosk.get('/api/v1/machine-detail/27?date=' + date).set('Cookie', auth).expect(200);
      const payload = (detail.body as { data: MachineDetailView }).data;
      expect(payload.personnelShift).toBe('2');
      expect(payload.personnel.map(({ nik, name }) => [nik, name])).toEqual([
        ['00123', 'Leader Sample'], ['00124', 'Cell Sample'], ['00125', 'Technician Sample'], ['00126', 'Operator Sample'],
      ]);
      const photo = payload.personnel[0]?.photoUrl;
      expect(photo).toBeDefined();
      await request(app).get(photo!).expect(401);
      await kiosk.get(photo!).set('Cookie', auth).expect('Content-Type', 'image/png').expect('Cache-Control', 'private, no-store').expect(200);
      await kiosk.get(photo!.replace('/27/', '/28/')).set('Cookie', auth).expect(403);
      await kiosk.get(photo!.replace('00123', '00999')).set('Cookie', auth).expect(404);
      await kiosk.get(payload.personnel[1]!.photoUrl!).set('Cookie', auth).expect(404);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
