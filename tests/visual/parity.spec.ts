import { expect, test, type Page } from '@playwright/test';

/* Visual parity harness (ADR-026). API is stubbed with page.route inside the test only (never in the bundle).
 * Step 1: `npm run test:visual -- --update-snapshots` once, review images side-by-side with the mockup reference
 *         screenshot, record verdicts in docs/06-testing/parity-matrix.md.
 * Step 2: later runs fail on visual regressions against the approved baseline. */

const me = { kind: 'user', csrfToken: 't', user: { id: 'u1', username: 'viewer', displayName: 'Test User', department: 'Kaizen Section', roleId: 'r1', roleName: 'Administrator', lastLoginAt: null,
  permissions: ['monitoring.production.view', 'monitoring.utilization.view', 'monitoring.stoptime.view', 'analysis.machinedetail.view', 'settings.view', 'monitoring.sales.view', 'monitoring.scrap.view', 'masterdata.view', 'export.production'] } };
const env = (data: unknown, state = 'current') => ({ state, data, freshness: 'not-applicable', sourceUpdatedAt: '2026-11-07T08:00:00+07:00', generatedAt: '2026-11-07T08:05:00+07:00', notices: [] });
const metric = (v: number | null) => (v === null ? { value: null, reason: 'Rumus belum disetujui (Q-003)' } : { value: v, reason: null });

/** Shift ada di popover periode: buka dulu, pilih, lalu Terapkan. */
async function openFilters(page: Page) {
  await page.locator('.period-filter .pbtn').click();
  await expect(page.getByRole('dialog', { name: 'Filter periode' })).toBeVisible();
}
async function applyFilters(page: Page, values: { shift?: string }) {
  await openFilters(page);
  if (values.shift !== undefined) await page.locator('#fShift').selectOption(values.shift);
  await page.getByRole('button', { name: 'Terapkan' }).click();
}

async function stub(page: Page, shiftGate?: Promise<void>) {
  await page.clock.setFixedTime(new Date('2026-11-07T10:00:00+07:00'));
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
  await page.route('**/api/v1/monitoring/production**', async (r) => {
    const shift = new URL(r.request().url()).searchParams.get('shift');
    if (shift === '2' && shiftGate) await shiftGate;
    await r.fulfill({ json: env({
    range: { from: '2026-10-26', to: '2026-11-07', shift: null, days: 13 },
    totals: { plan: 60000, actual: shift === '2' ? 9000 : 49000, gross: 50200, reject: 1200, bekidoritsu: metric(81.7), deviation: -11000, ipr: metric(24490), stopMinutes: 870 }, previous: null,
    machines, daily: Array.from({ length: 13 }, (_, i) => ({ date: `2026-${i < 6 ? '10' : '11'}-${String(i < 6 ? 26 + i : i - 5).padStart(2, '0')}`, plan: i % 7 === 6 ? 0 : 5000, actual: i % 7 === 6 ? 0 : 4100, bekidoritsu: metric(i % 7 === 6 ? null : 82) })),
    groups: [{ group: 'A', plan: 30000, actual: 25000, bekidoritsu: metric(83.3) }, { group: 'B', plan: 30000, actual: 24000, bekidoritsu: metric(80) }],
    }) });
  });
  await page.route('**/api/v1/monitoring/sales**', (r) => r.fulfill({ json: env({
    range: { from: '2026-10-26', to: '2026-11-07', days: 13 },
    total: metric(1200000), goodQty: 12000, coveredQty: 12000, uncoveredQty: 0, averagePrice: metric(100),
    byMonth: [{ key: '2026-11', sales: 1200000, goodQty: 12000, uncoveredQty: 0, hasValuation: true }],
    byDay: [{ key: '2026-11-07', sales: 1200000, goodQty: 12000, uncoveredQty: 0, hasValuation: true }],
    byPart: [{ dpNo: 'DP-1001', productName: 'PART 1', goodQty: 12000, pricePerPcs: 100, sales: metric(1200000) }],
  }) }));
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

test('UI behavior · selection hides previous results and disables exports', async ({ page }) => {
  let resume!: () => void;
  const hold = new Promise<void>((resolve) => { resume = resolve; });
  await stub(page, hold);
  await page.goto('/production');
  const actual = page.locator('.deck .kpi').nth(1);
  await expect(actual).toContainText('49,000');
  await page.getByRole('tab', { name: 'Daily trend' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'By machine' })).toBeFocused();
  await applyFilters(page, { shift: '2' });
  try {
    await expect(page.getByRole('button', { name: /Export/ })).toBeDisabled();
    await expect(page.getByText('49,000', { exact: true })).toHaveCount(0);
  } finally { resume(); }
  await expect(actual).toContainText('9,000');
  await expect(page.getByRole('button', { name: /Export/ })).toBeEnabled();
});

test('UI behavior · drill-down preserves machine scope', async ({ page }) => {
  await stub(page);
  await page.route('**/api/v1/monitoring/daily-rates**', (r) => r.fulfill({ json: env(null, 'empty') }));
  await page.goto('/production');
  const scoped = page.waitForResponse((response) => response.url().includes('/monitoring/production') && new URL(response.url()).searchParams.get('q') === 'DP-1001');
  await page.locator('#fSearch').fill('DP-1001');
  await scoped;
  const request = page.waitForRequest((r) => r.url().includes('/monitoring/daily-rates'));
  await page.locator('.deck .kpi').nth(2).click();
  const params = new URL((await request).url()).searchParams;
  expect(params.get('q')).toBe('DP-1001');
  expect(params.get('status')).toBeNull();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('UI behavior · navigation stays in the phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stub(page);
  await page.goto('/production');
  await expect(page.locator('.deck .kpi').nth(1)).toContainText('49,000');
  await expect(page.locator('#app-navigation')).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('link', { name: 'Production', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('UI behavior · Sales exposes period and shift', async ({ page }) => {
  await stub(page);
  await page.goto('/sales');
  await openFilters(page);
  await expect(page.locator('#fShift')).toBeVisible();
  await expect(page.locator('#fStatus')).toHaveCount(0);
  await expect(page.getByText('Valuasi memakai harga terakhir yang tercatat sampai akhir tanggal produksi (tanggal lokal plant). Harga sebelum histori dimulai tidak ditebak. Kolom harga kosong juga dapat berarti harga berbeda dalam periode.', { exact: true })).toBeVisible();
});

for (const viewport of [{width:1024,height:768},{width:1133,height:744},{width:1180,height:820},{width:1366,height:1024}]) {
test.describe(`Viewport ${viewport.width}x${viewport.height}`, () => {
  // Initialise viewport and screen before creating the page, preserving mobile/touch emulation.
  test.use({ viewport, screen: viewport });
test(`UI behavior · Machine Detail fits beside the full sidebar (${viewport.width}x${viewport.height})`, async ({ page }) => {
  await stub(page);
  await page.route('**/api/me/preferences', (r) => r.fulfill({ json: { page: 'prod', period: 'lw_tw', shift: '', theme: 'light', side: 'full', motion: 'off', cols: [] } }));
  await page.route('**/api/v1/machines?**', (r) => r.fulfill({ json: env({ date: '2026-11-07', prevDate: null, nextDate: null, machines: [{ machineNo: '20' }] }) }));
  await page.route('**/api/v1/machine-detail/20?**', (r) => r.fulfill({ json: env({
    machineNo: '20', date: '2026-11-07', prevDate: null, nextDate: null, hasRecord: true,
    header: { dpNo: 'DP-1001', productName: 'LONG PRODUCT NAME FOR TEST', poNo: '01', cavity: '4', ctPlan: metric(10), ctActual: metric(10) },
    personnel: [], shifts: [], stops: [], stopCategories: [],
    totals: { plan: 100000, actual: 120000, gross: 122000, reject: 2000, deviation: 20000, ipr: metric(16667), stopMinutes: 0, bekidoritsu: metric(120), oee: metric(60) },
    hourly: { available: false, reason: 'Fixture' }, rejectPareto: [],
  }) }));
  await page.goto('/machines/20');
  const figures = page.locator('#mdHost .page.on .figs');
  await expect(figures).toContainText('120,000');
  await expect(page.locator('#mdHost .page.on .output-summary')).toBeVisible();
  await expect(figures.locator(':scope > div')).toHaveCount(6);
  const bounds = await figures.evaluate((element) => {
    const card = element.closest('.output-summary');
    if (!card) throw new Error('Output summary card not found');
    const parent = card.getBoundingClientRect();
    const children = [...element.querySelectorAll(':scope > div')];
    return { fits: children.every((child) => { const rect = child.getBoundingClientRect(); return rect.left >= parent.left - 1 && rect.right <= parent.right + 1; }), figures: children.length };
  });
  expect(bounds).toEqual({ fits: true, figures: 6 });
  const layout = await page.evaluate(() => {
    const width = window.innerWidth;
    const offenders = [...document.querySelectorAll('body *')].flatMap((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.right > width + 1
        ? [{ element: el.tagName, id: el.id, className: el.getAttribute('class'), right: Math.round(rect.right), width: Math.round(rect.width) }]
        : [];
    }).slice(0, 20);
    return { width, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
      rootWidth: document.documentElement.getBoundingClientRect().width, screenWidth: screen.width, screenHeight: screen.height,
      visualWidth: visualViewport?.width ?? null, visualScale: visualViewport?.scale ?? null,
      dpr: devicePixelRatio, viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content'), offenders };
  });
  const diagnostic = JSON.stringify({ requested: viewport, actual: layout });
  // Never silently pass a test at an incorrectly emulated viewport.
  expect(Math.abs(layout.width - viewport.width), `Viewport emulation mismatch: ${diagnostic}`).toBeLessThanOrEqual(1);
  expect(layout.scrollWidth, diagnostic).toBeLessThanOrEqual(layout.width + 1);
});
});
}
