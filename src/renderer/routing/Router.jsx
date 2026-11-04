import {
  HashRouter,
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  Outlet,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Prompt from '../components/other/Prompt';
import Popup from '../components/other/Popup';
import SystemNotifications from '../components/other/SystemNotifications';
import MicrosoftLoginListener from '../components/other/MicrosoftLoginListener';
import Loader from '../components/other/Loader';
import AppTutorial from '../components/tutorials/AppTurorial';
import GettingStartedChecklist from '../components/intro/GettingStartedChecklist';
import DialogAPI from '../components/other/dialogs/DialogAPI';
import { AppProvider } from '../redux/appContext';
import AltUpdateRequests from '../components/other/AltUpdateRequests';
import Dashboard from '../pages/Dashboard';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Spin, Typography } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import SidePanelContextProvider from 'renderer/components/other/botSideBar/SidePanelContextProvider';
import OptionErrorListener from 'renderer/components/other/OptionErrorListener';
import ShareLinkListener from 'renderer/components/share/ShareLinkListener';
import ShareModal from 'renderer/components/share/ShareModal';
import {
  useSettingsStore,
  selectReady,
  selectInstalledServerIds,
} from '../redux/settings';
import AutomationSessionStrip from '../components/automations/AutomationSessionStrip';
import PageLoading from '../components/common/PageLoading';
import lazyPage, { preloadPages } from './lazyPage';

const Alts = lazyPage(() => import('../pages/Alts'));
const Bot = lazyPage(() => import('../pages/Bot'));
const Macros = lazyPage(() => import('../pages/Macros'));
const Discord = lazyPage(() => import('../pages/Discord'));
const CodeEditor = lazyPage(() => import('../pages/CodeEditor'), { preload: false });
const Connections = lazyPage(() => import('../pages/Connections'));
const JNbotProxy = lazyPage(() => import('../pages/JNbotProxy'));
const Recording = lazyPage(() => import('../pages/Recording'), { preload: false });
const McLauncher = lazyPage(() => import('../pages/McLauncher'));
const Intro = lazyPage(() => import('../pages/Intro'), { preload: false });
const ProfileWizard = lazyPage(() => import('../pages/ProfileWizard'), { preload: false });
const SelectServerPage = lazyPage(() => import('../pages/SelectServerPage'), { preload: false });
const McServer = lazyPage(() => import('renderer/pages/McServer'));
const McServerDetail = lazyPage(() => import('renderer/pages/McServerDetail'));
const AutomationEditor = lazyPage(() => import('../pages/AutomationEditor'), { preload: false });
const AIControl = lazyPage(() => import('../pages/AIControl'));
const Triggers = lazyPage(() => import('../pages/Triggers'));
const Marketplace = lazyPage(() => import('../pages/Marketplace'));
const MacroSidebarWrapper = lazyPage(() => import('../components/macroEditor/MacroSideBarWrapper'), { preload: false });

const RouteLoading = () => {
  const { pathname } = useLocation();
  const layout = /^\/(code|macros|recordings)\//.test(pathname)
    ? 'editor'
    : /^\/(alts|bot|plugins)(\/|$)/.test(pathname)
      ? 'rows'
      : 'panels';

  return <PageLoading key={pathname} layout={layout} />;
};

const MainRouterContent = () => {
  const ready = useSettingsStore(selectReady);
  const hasServers = useSettingsStore(
    (s) => selectInstalledServerIds(s).length > 0,
  );
  const hasSelection = useSettingsStore((s) => !!s.selectedProfileKey);

  useEffect(() => {
    if (ready) preloadPages();
  }, [ready]);

  // Wait for the active server + install list before deciding, so we don't
  // flash the picker during the initial load.
  if (!ready) {
    return (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Spin indicator={<LoadingOutlined style={{ fontSize: 48 }} spin />} />
      </div>
    );
  }

  // Everything under here needs a usable server. With none installed, send the
  // user to the intro to pick or create one — they can't use the app without a profile.
  if (!hasServers) {
    if (window.web) {
      return (
        <div style={{ display: 'flex', width: '100%', height: '100vh', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div>
            <Typography.Title level={2}>No profile access</Typography.Title>
            <Typography.Text type="secondary">This access link has not been granted any active JNbot profiles.</Typography.Text>
          </div>
        </div>
      );
    }
    return <Navigate to="/intro" replace />;
  }

  // Nothing loads without a selected profile, so ask for one first.
  if (!hasSelection && !window.web) return <Navigate to="/select-server" replace />;

  return (
    <div style={{ width: '100vw', overflow: 'hidden' }}>
      <Sidebar>
        <div
          style={{
            maxWidth: '1500px',
            width: 'calc(100% - 1rem)',
            margin: '0 auto',
          }}
        >
          <Suspense fallback={<RouteLoading />}>
            <Outlet />
          </Suspense>
        </div>
      </Sidebar>
      {!window.web && <GettingStartedChecklist />}
    </div>
  );
};

const MoveableNavBar = () => {
  return (
    <div
      style={{
        width: '100%',
        height: '3rem',
        zIndex: 1000,
      }}
      className="drag-region"
    >
      <Suspense fallback={<RouteLoading />}>
        <Outlet />
      </Suspense>
    </div>
  );
};

const AppRoutes = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [redirecting, setRedirecting] = useState(false);
  const pendingRedirectRef = useRef(null);

  const redirectTarget = useMemo(() => {
    const searchSources = [location.search, window.location?.search]
      .filter(Boolean)
      .map((search) => search ?? '');

    for (const search of searchSources) {
      const params = new URLSearchParams(search);
      if (!params.has('redirect')) continue;
      const raw = params.get('redirect');
      if (!raw) continue;
      const decoded = decodeURIComponent(raw);
      if (decoded && decoded.startsWith('/')) {
        return decoded;
      }
    }

    return null;
  }, [location.search]);

  const shouldRedirect = Boolean(
    redirectTarget && redirectTarget !== location.pathname,
  );

  useEffect(() => {
    if (shouldRedirect && redirectTarget) {
      if (pendingRedirectRef.current === redirectTarget) return;

      pendingRedirectRef.current = redirectTarget;
      setRedirecting(true);
      navigate(redirectTarget, { replace: true });
      return;
    }

    if (redirecting) {
      setRedirecting(false);
    }
    pendingRedirectRef.current = null;
  }, [
    navigate,
    redirectTarget,
    redirecting,
    shouldRedirect,
    location.pathname,
  ]);

  if (redirecting) {
    return (
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: '100vh',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Typography.Text strong>Loading...</Typography.Text>
      </div>
    );
  }
  return (
    <SidePanelContextProvider>
      <AppProvider>
        <AltUpdateRequests />
        <Popup />
        <SystemNotifications />
        <MicrosoftLoginListener />
        <Prompt />
        <Loader />
        <DialogAPI />
        <AppTutorial />
        <OptionErrorListener />
        <ShareLinkListener />
        <ShareModal />
        <AutomationSessionStrip />

        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/intro" element={<Intro />} />
            <Route element={<MoveableNavBar />}>
              <Route path="/select-server" element={<SelectServerPage />} />
              <Route path="/profiles/new" element={window.web ? <Navigate to="/" replace /> : <ProfileWizard />} />
              <Route path="/profiles/:id/edit" element={window.web ? <Navigate to="/" replace /> : <ProfileWizard />} />
            </Route>

            <Route path="/macros/:id" element={<MacroSidebarWrapper />} />
            <Route path="/code/:id" element={<CodeEditor />} />
            <Route path="/" element={<MainRouterContent />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/alts" element={<Alts />} />
              <Route path="/settings" element={<Dashboard />} />
              <Route path="/profiles" element={window.web ? <Navigate to="/" replace /> : <Dashboard />} />
              <Route path="/bot" element={<Bot />} />
              <Route path="/plugins" element={<Macros />} />
              <Route path="/triggers" element={<Triggers />} />
              <Route path="/marketplace" element={<Marketplace />} />
              <Route path="/recordings/:id" element={<AutomationEditor />} />
              <Route path="/launcher" element={<McLauncher />} />
              <Route path="/discord" element={<Discord />} />
              <Route path="/jnbotserver" element={window.web ? <Navigate to="/" replace /> : <Connections />} />
              <Route path="/jnbotproxy" element={<JNbotProxy />} />
              <Route path="/mcp" element={<AIControl />} />
              <Route path="/jnbotproxy/recordings/:id" element={<Recording />} />

              <Route path="/mc-server" element={<McServer />} />
              <Route path="/mc-server/:serverId" element={<McServerDetail />} />
            </Route>
          </Routes>
        </Suspense>
      </AppProvider>
    </SidePanelContextProvider>
  );
};

const Router = () => {
  if (window.web) {
    return (
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    );
  } else {
    return (
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    );
  }
};

export default Router;
