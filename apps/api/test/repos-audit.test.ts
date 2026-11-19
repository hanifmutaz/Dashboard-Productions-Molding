import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createPgRepos } from '../src/db/repos.js';

describe('database transaction for audited mutations', () => {
  it('rolls back on audit failure and uses one client for both writes', async () => {
    const query = vi.fn((sql: string) => sql.startsWith('INSERT INTO audit_log')
      ? Promise.reject(new Error('audit unavailable')) : Promise.resolve({ rowCount: 1, rows: [] }));
    const release = vi.fn();
    const poolQuery = vi.fn();
    const repos = createPgRepos({ connect: () => Promise.resolve({ query, release }), query: poolQuery } as unknown as pg.Pool);

    await expect(repos.transaction(async () => {
      await repos.users.setPassword('user', 'test-hash');
      await repos.audit.append({ actorUserId: null, actorLabel: null, requestId: null, action: 'test', result: 'success' });
    })).rejects.toThrow('audit unavailable');

    expect(query.mock.calls.map(([sql]) => sql.split(' ').slice(0, 3).join(' '))).toEqual([
      'BEGIN', 'UPDATE app_user SET', 'INSERT INTO audit_log', 'ROLLBACK',
    ]);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });
});
