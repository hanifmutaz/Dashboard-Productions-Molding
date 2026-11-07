import type { ReactNode } from 'react';
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation, useRouteError } from 'react-router';
import type { Permission } from '@mpd/contracts';
import { useSession } from './lib/session';
import { FilterProvider } from './lib/filters';
import { AppShell, PAGES } from './shell/AppShell';
import { ProductionPage } from './pages/Production';
import { UtilizationPage } from './pages/Utilization';
import { StopTimePage } from './pages/StopTime';
import { NeedPartPage, SalesPage, ScrapPage } from './pages/SalesScrap';
import { MachineDetailPage, MachineListPage } from './pages/Machines';
import { MasterDataPage } from './pages/MasterData';
import { SettingsPage } from './pages/Settings';
import { ProfilePage } from './pages/Profile';
import { AuditPage, KiosksPage, UsersPage } from './pages/Admin';
import { ErrorPanel, ForbiddenPage, LoginPage, NotFoundPage } from './pages/Auth';
import { KioskPage } from './pages/Kiosk';

function Loading() {
  return <div className="empty" role="status" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Memuat…</div>;
}

/** Signed-in user required; a kiosk credential may only use /kiosk. */
function RequireUser() {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loading) return <Loading />;
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
  const { loading } = useSession();
  return loading ? <Loading /> : <FilterProvider><Outlet /></FilterProvider>;
}
const g = (key: string, el: ReactNode) => <Guard perm={PAGES.find((p) => p.key === key)?.perm}>{el}</Guard>;

const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      { element: <Public />, children: [{ path: '/login', element: <LoginPage /> }, { path: '/kiosk', element: <KioskPage /> }] },
      {
        element: <RequireUser />,
        children: [
          { index: true, element: <Home /> },
          { path: 'production', element: g('prod', <ProductionPage />) },
          { path: 'utilization', element: g('util', <UtilizationPage />) },
          { path: 'stop-time', element: g('stop', <StopTimePage />) },
          { path: 'sales', element: g('sales', <SalesPage />) },
          { path: 'scrap', element: g('scrap', <ScrapPage />) },
          { path: 'need-part', element: <NeedPartPage /> },
          { path: 'machines', element: g('detail', <MachineListPage />) },
          { path: 'machines/:machineNo', element: g('detail', <MachineDetailPage />) },
          { path: 'master-data', element: g('master', <MasterDataPage />) },
          { path: 'settings', element: g('settings', <SettingsPage />) },
          { path: 'admin/users', element: g('users', <UsersPage />) },
          { path: 'admin/kiosks', element: g('kiosks', <KiosksPage />) },
          { path: 'admin/audit', element: g('audit', <AuditPage />) },
          { path: 'profile', element: <ProfilePage /> },
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
