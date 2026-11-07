import { expect, test, type Page } from '@playwright/test';

/* Visual parity harness (ADR-026). API is stubbed with page.route inside the test only (never in the bundle).
 * Step 1: `npm run test:visual -- --update-snapshots` once, review images side-by-side with the mockup reference
 *         screenshot, record verdicts in docs/06-testing/parity-matrix.md.
 * Step 2: later runs fail on visual regressions against the approved baseline. */

const me = { kind: 'user', csrfToken: 't', user: { id: 'u1', username: 'viewer', displayName: 'Test User', department: 'Kaizen Section', roleId: 'r1', roleName: 'Administrator', lastLoginAt: null,
  permissions: ['monitoring.production.view', 'monitoring.utilization.view', 'monitoring.stoptime.view', 'analysis.machinedetail.view', 'settings.view', 'monitoring.sales.view', 'monitoring.scrap.view', 'masterdata.view'] } };
const env = (data: unknown, state = 'current') => ({ state, data, freshness: 'not-applicable', sourceUpdatedAt: '2026-11-07T08:00:00+07:00', generatedAt: '2026-11-07T08:05:00+07:00', notices: [] });
const metric = (v: number | null) => (v === null ? { value: null, reason: 'Rumus belum disetujui (Q-003)' } : { value: v, reason: null });

async function stub(page: Page) {
  await page.route('**/api/auth/me', (r) => r.fulfill({ json: me }));
  await page.route('**/api/me/preferences', (r) => r.fulfill({ json: { page: 'prod', period: 'lw_tw', shift: '', theme: 'light', side: '', motion: 'off', cols: [] } }));
  await page.route('**/api/settings', async (r) => {
    const { DEFAULT_SETTINGS } = await import('../../packages/contracts/dist/index.js');
    await r.fulfill({ json: { ...DEFAULT_SETTINGS, version: 0, updatedAt: '2026-11-07T00:00:00Z', updatedBy: null } });
  });
  const machines = Array.from({ length: 6 }, (_, i) => ({
    machineNo: String(20 + i), dpNo: `DP-${1001 + i}`, productName: `PART ${i + 1}`, plan: 10000, actual: 7000 + i * 600, gross: 7200 + i * 600, reject: 200, deviation: -3000 + i * 600,
    bekidoritsu: metric(70 + i * 6), ipr: metric(28000), stopMinutes: 120 + i * 10, sharePct: metric(16), rejectPct: metric(2.7), rejects: [{ name: 'Burry', qty: 200 }], achievement: 'attention',
  }));
  await page.route('**/api/v1/monitoring/production**', (r) => r.fulfill({ json: env({
    range: { from: '2026-10-26', to: '2026-11-07', shift: null, days: 13 },
    totals: { plan: 60000, actual: 49000, gross: 50200, reject: 1200, bekidoritsu: metric(81.7), deviation: -11000, ipr: metric(24490), stopMinutes: 870 }, previous: null,
    machines, daily: Array.from({ length: 13 }, (_, i) => ({ date: `2026-${i < 6 ? '10' : '11'}-${String(i < 6 ? 26 + i : i - 5).padStart(2, '0')}`, plan: i % 7 === 6 ? 0 : 5000, actual: i % 7 === 6 ? 0 : 4100, bekidoritsu: metric(i % 7 === 6 ? null : 82) })),
    groups: [{ group: 'A', plan: 30000, actual: 25000, bekidoritsu: metric(83.3) }, { group: 'B', plan: 30000, actual: 24000, bekidoritsu: metric(80) }],
  }) }));
  await page.route('**/api/v1/monitoring/sales**', (r) => r.fulfill({ json: { ...env(null, 'unavailable'), notices: [{ code: 'Q-009', message: 'Rumus, sumber harga dan approver Sales/Scrap belum ditetapkan.' }] } }));
}

for (const path of ['/production', '/sales']) {
  test(`app ${path}`, async ({ page }) => {
    await stub(page);
    await page.goto(path);
    await page.waitForSelector('.deck .kpi');
    await expect(page).toHaveScreenshot(`app${path.replace('/', '-')}.png`, { fullPage: true, animations: 'disabled' });
  });
}

test('mockup reference (side-by-side review only)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'reference captured once');
  await page.goto('file://' + process.cwd().replaceAll('\\', '/') + '/mockup/dashboard-molding-mockup-v1.10.html');
  await page.screenshot({ path: 'test-results/mockup-reference-production.png', fullPage: true });
});

test('NFR-UI: touch targets ≥ 44px and text ≥ 12px on iPad', async ({ page }, info) => {
  test.skip(info.project.name !== 'ipad-webkit', 'iPad only');
  await stub(page);
  await page.goto('/production');
  await page.waitForSelector('.deck .kpi');
  const small = await page.$$eval('button, select, input, [role=button]', (els) =>
    els.filter((e) => (e as HTMLElement).offsetParent && (e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44)).map((e) => e.outerHTML.slice(0, 80)));
  expect(small).toEqual([]);
  const tiny = await page.$$eval('body *', (els) => els.filter((e) => (e as HTMLElement).offsetParent && e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12).map((e) => e.tagName + '.' + e.className));
  expect(tiny).toEqual([]);
});
