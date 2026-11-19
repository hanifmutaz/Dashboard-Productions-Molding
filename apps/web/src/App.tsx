import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation, useRouteError } from 'react-router';
import type { Permission } from '@mpd/contracts';
import { useSession } from './lib/session';
import { FilterProvider } from './lib/filters';
import { AppShell, PAGES } from './shell/AppShell';
import { ErrorPanel, ForbiddenPage, LoginPage, NotFoundPage } from './pages/Auth';

/* Pages are loaded per route so the first screen (and the floor iPads) only download what they show. */
const ProductionPage = lazy(() => import('./pages/Production').then((m) => ({ default: m.ProductionPage })));
const UtilizationPage = lazy(() => import('./pages/Utilization').then((m) => ({ default: m.UtilizationPage })));
const StopTimePage = lazy(() => import('./pages/StopTime').then((m) => ({ default: m.StopTimePage })));
const SalesPage = lazy(() => import('./pages/SalesScrap').then((m) => ({ default: m.SalesPage })));
const ScrapPage = lazy(() => import('./pages/SalesScrap').then((m) => ({ default: m.ScrapPage })));
const NeedPartPage = lazy(() => import('./pages/SalesScrap').then((m) => ({ default: m.NeedPartPage })));
const MachineListPage = lazy(() => import('./pages/Machines').then((m) => ({ default: m.MachineListPage })));
const MachineDetailPage = lazy(() => import('./pages/Machines').then((m) => ({ default: m.MachineDetailPage })));
const MasterDataPage = lazy(() => import('./pages/MasterData').then((m) => ({ default: m.MasterDataPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));
const SystemStatusPage = lazy(() => import('./pages/SystemStatus').then((m) => ({ default: m.SystemStatusPage })));
const ProfilePage = lazy(() => import('./pages/Profile').then((m) => ({ default: m.ProfilePage })));
const UsersPage = lazy(() => import('./pages/Admin').then((m) => ({ default: m.UsersPage })));
const KiosksPage = lazy(() => import('./pages/Admin').then((m) => ({ default: m.KiosksPage })));
const AuditPage = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AuditPage })));
const KioskPage = lazy(() => import('./pages/Kiosk').then((m) => ({ default: m.KioskPage })));

const PageLoading = () => <div className="empty" role="status">Memuat halaman…</div>;
const s = (el: ReactNode) => <Suspense fallback={<PageLoading />}>{el}</Suspense>;

function Loading() {
  return <div className="empty" role="status" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Memuat…</div>;
}

function SessionUnavailable() {
  const { refreshMe } = useSession();
  return <div className="authwrap"><section className="card authcard"><div className="cb problem-message" role="alert">
    <h1 className="authh">Koneksi ke server bermasalah</h1>
    <p className="mu">Status sesi belum bisa diperiksa.</p>
    <button className="btn pri" type="button" onClick={() => void refreshMe()}>Coba lagi</button>
  </div></section></div>;
}

/** Signed-in user required; a kiosk credential may only use /kiosk. */
function RequireUser() {
  const { me, loading, sessionError } = useSession();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (sessionError) return <SessionUnavailable />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me.kind === 'kiosk') return <Navigate to="/kiosk" replace />;
  return <FilterProvider><AppShell /></FilterProvider>;
}
/** UI guard mirrors the server rule (the API is the real enforcement point). */
function Guard({ perm, children }: { perm?: Permission; children: ReactNode }) {
  const { can } = useSession();
  return perm && !can(perm) ? <ForbiddenPage /> : <>{children}</>;
}
function Home() {
  const { prefs, can } = useSession();
  const pref = PAGES.find((p) => p.key === prefs.page && (!p.perm || can(p.perm)));
  const first = pref ?? PAGES.find((p) => p.perm && can(p.perm));
  return <Navigate to={first?.path ?? '/profile'} replace />;
}
function RouteError() {
  return <ErrorPanel error={useRouteError()} />;
}
function Public() {
  const { loading, sessionError } = useSession();
  return loading ? <Loading /> : sessionError ? <SessionUnavailable /> : <FilterProvider><Outlet /></FilterProvider>;
}
const g = (key: string, el: ReactNode) => <Guard perm={PAGES.find((p) => p.key === key)?.perm}>{s(el)}</Guard>;

const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { element: <Public />, children: [{ path: '/login', element: <LoginPage /> }, { path: '/kiosk', element: s(<KioskPage />) }] },
      {
        element: <RequireUser />,
        children: [
          { index: true, element: <Home /> },
          { path: 'production', element: g('prod', <ProductionPage />) },
          { path: 'utilization', element: g('util', <UtilizationPage />) },
          { path: 'stop-time', element: g('stop', <StopTimePage />) },
          { path: 'sales', element: g('sales', <SalesPage />) },
          { path: 'scrap', element: g('scrap', <ScrapPage />) },
          { path: 'need-part', element: s(<NeedPartPage />) },
          { path: 'machines', element: g('detail', <MachineListPage />) },
          { path: 'machines/:machineNo', element: g('detail', <MachineDetailPage />) },
          { path: 'master-data', element: g('master', <MasterDataPage />) },
          { path: 'settings', element: g('settings', <SettingsPage />) },
          { path: 'admin/users', element: g('users', <UsersPage />) },
          { path: 'admin/kiosks', element: g('kiosks', <KiosksPage />) },
          { path: 'admin/audit', element: g('audit', <AuditPage />) },
          { path: 'status', element: s(<SystemStatusPage />) },
          { path: 'profile', element: s(<ProfilePage />) },
          { path: 'forbidden', element: <ForbiddenPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
