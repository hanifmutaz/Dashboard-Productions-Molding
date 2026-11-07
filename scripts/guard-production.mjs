// Production guard (STATE §14): fails when dev/mockup artefacts reach production source or output.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const problems = [];
const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const rel = (p) => path.relative(root, p).replaceAll('\\', '/');

const webDist = path.join(root, 'apps/web/dist');
const apiDist = path.join(root, 'apps/api/dist');
for (const d of [webDist, apiDist]) if (!existsSync(d)) problems.push(`missing build output: ${rel(d)} (run npm run build first)`);

const FORBIDDEN = [
  [/Mockup: (normal|stale|loading|source down)/, 'mockup dev selector'],
  [/mockstate|simSel/, 'mockup simulation control'],
  [/mockup v1\.10/i, 'mockup version label'],
  [/Hanif Mu'?taz/i, 'hardcoded user identity'],
  [/mockServiceWorker|setupServer|setupWorker|\[MSW\]/, 'MSW / mock stub'],
  [/@mpd\/test-utils/, 'test utilities'],
  [/__baseline__/, 'visual baseline asset'],
  [/VITE_(USE_)?(STUB|MOCK|FIXTURE)/, 'stub environment flag'],
];
for (const f of [...walk(webDist), ...walk(apiDist)]) {
  if (/\.(png|jpg|ico|woff2?)$/.test(f)) {
    if (/baseline|snapshot/i.test(f)) problems.push(`baseline asset in output: ${rel(f)}`);
    continue;
  }
  if (/\.html?$/.test(f) && path.basename(f) !== 'index.html') problems.push(`unexpected HTML in output: ${rel(f)}`);
  const text = readFileSync(f, 'utf8');
  for (const [re, what] of FORBIDDEN) if (re.test(text)) problems.push(`${what} in ${rel(f)}`);
}

for (const f of [...walk(path.join(root, 'apps/web/src')), ...walk(path.join(root, 'apps/api/src'))]) {
  if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$|[\\/]test[\\/]/.test(f)) continue;
  const text = readFileSync(f, 'utf8');
  if (/from ['"](msw|msw\/node|@mpd\/test-utils)['"]/.test(text)) problems.push(`test-only import in production source: ${rel(f)}`);
  if (/import .*(fixture|stub)/i.test(text)) problems.push(`fixture/stub import in production source: ${rel(f)}`);
  if (/Mockup: /.test(text)) problems.push(`mockup selector text in source: ${rel(f)}`);
}

for (const f of walk(path.join(root, 'apps'))) if (/dashboard-molding-mockup/i.test(path.basename(f))) problems.push(`mockup HTML inside apps/: ${rel(f)}`);

if (problems.length) {
  console.error(`guard:production FAILED (${problems.length})`);
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}
console.log('guard:production PASS');
