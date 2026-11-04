import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ConfigProvider,
  Layout,
  Menu,
  type MenuProps,
  theme as antTheme,
} from 'antd';
import {
  HomeOutlined,
  TeamOutlined,
  DiscordOutlined,
  CloudServerOutlined,
  GlobalOutlined,
  SettingOutlined,
  CloudOutlined,
  ShopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { LuBot, LuGamepad2 } from 'react-icons/lu';
import { MdOutlineExtension } from 'react-icons/md';
import { RiRobot2Line } from 'react-icons/ri';
import { VscMcp } from 'react-icons/vsc';
import { TbBrandMinecraft } from 'react-icons/tb';

import { useLocation, useNavigate } from 'react-router-dom';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Themes } from 'common/CommonEnums';
import Nav from './Nav';
import ServerModeSelector from './ServerModeSelector';
import useApp from '../hooks/useApp';
import Footer from './Footer';
import {
  useSettingsStore,
  selectAppSettings,
  selectCanManageAccess,
  selectCanUseAccounts,
  selectCanUseActiveBots,
  selectCanUseHostTools,
  selectCanUsePlugins,
  selectCanUseScripts,
  updateAppSetting,
} from '../redux/settings';
import PinnedSidePanel from './other/botSideBar/PinnedSidePanel';
import { usePanelContext } from './other/botSideBar/SidePanelContextProvider';
import { IoCubeOutline } from 'react-icons/io5';
import { lazy, Suspense } from 'react';
const SettingsModal = lazy(() => import('./settings/SettingsModal'));
import PageBreadCrumbs from './PageBreadcrumbs';
import { AnnouncementProvider } from './announcements/AnnouncementProvider';
import { AnnouncementBanner } from './announcements/AnnouncementViews';

const { Header, Sider, Content } = Layout;

// Side panel open/close animation tuning.
const SIDE_PANEL_SIZE = 35; // default width (% of the split) when expanded

export type NavigationKey =
  | 'dashboard'
  | 'alts'
  | 'bot'
  | 'plugins'
  | 'triggers'
  | 'marketplace'
  | 'launcher'
  | 'discord'
  | 'mc-server'
  | 'jnbotserver'
  | 'jnbotproxy'
  | 'mcp'
  | 'settings'

type NavigationSection = 'profiles-and-bots' | 'minecraft' | 'developer-tools';

const navigationPaths: Record<NavigationKey, string> = {
  dashboard: '/',
  alts: '/alts',
  bot: '/bot',
  plugins: '/plugins',
  triggers: '/triggers',
  marketplace: '/marketplace',
  launcher: '/launcher',
  discord: '/discord',
  'mc-server': '/mc-server',
  jnbotserver: '/jnbotserver',
  jnbotproxy: '/jnbotproxy',
  mcp: '/mcp',
  settings: '/settings',
};

const navigationSections: Partial<Record<NavigationKey, NavigationSection>> = {
  alts: 'profiles-and-bots',
  bot: 'profiles-and-bots',
  plugins: 'profiles-and-bots',
  triggers: 'profiles-and-bots',
  launcher: 'minecraft',
  discord: 'minecraft',
  'mc-server': 'minecraft',
  jnbotserver: 'developer-tools',
  jnbotproxy: 'developer-tools',
  mcp: 'developer-tools',
};

const SidebarContent: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { theme } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const { panel, setPanel } = usePanelContext();
  const appSettings = useSettingsStore(selectAppSettings);
  const canUseAccounts = useSettingsStore(selectCanUseAccounts);
  const canUseActiveBots = useSettingsStore(selectCanUseActiveBots);
  const canUsePlugins = useSettingsStore(selectCanUsePlugins);
  const canUseScripts = useSettingsStore(selectCanUseScripts);
  const canManageAccessPermission = useSettingsStore(selectCanManageAccess);
  const canUseHostToolsPermission = useSettingsStore(selectCanUseHostTools);
  const [isViewportNarrow, setIsViewportNarrow] = useState(false);
  const sidebarCollapsed = appSettings.sidebarCollapsed === true;
  const isSidebarCollapsed = sidebarCollapsed || isViewportNarrow;

  const handleSidebarCollapse = useCallback(
    (collapsed: boolean, type: 'clickTrigger' | 'responsive') => {
      if (type === 'responsive') {
        setIsViewportNarrow(collapsed);
        return;
      }
      if (collapsed === sidebarCollapsed) return;
      updateAppSetting('sidebarCollapsed', collapsed);
    },
    [sidebarCollapsed],
  );

  const reduceMotion = Boolean(appSettings?.reduceMotion);
  const [panelMounted, setPanelMounted] = useState(panel.active);
  const expandedSizeRef = useRef<number>(SIDE_PANEL_SIZE);
  const showPanel = panel.active || panelMounted;
  const handlePanelExited = useCallback(() => setPanelMounted(false), []);

  useEffect(() => {
    if (panel.active) setPanelMounted(true);
  }, [panel.active]);

  const { token } = antTheme.useToken();
  const {
    borderRadiusLG,
    colorBgContainer,
    colorBorderSecondary,
    colorBgLayout,
    colorPrimaryBg,
    colorPrimaryText,
    colorText,
    fontSizeLG,
    marginXS,
    marginSM,
    sizeLG,
    sizeXL,
    sizeXXL,
  } = token;
  const siderWidth = sizeXXL * 4;
  const collapsedSiderWidth = sizeXL * 2;
  const headerHeight = sizeXXL;

  const platform = (window as any).platform as NodeJS.Platform | undefined;
  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';

  const menuTheme: 'light' | 'dark' =
    theme === Themes.LIGHT || theme === Themes.NIGHT ? 'light' : 'dark';
  const [settingsModalState, setSettingsModalState] = useState<{
    open: boolean;
    tab?: string;
  }>({
    open:
      location.pathname === '/settings' || location.pathname === '/profiles',
    tab: location.pathname === '/profiles' ? 'profiles' : undefined,
  });

  const openSettings = useCallback((tab?: string) => {
    setSettingsModalState({ open: true, tab });
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsModalState({ open: false, tab: undefined });
    if (
      location.pathname === '/settings' ||
      location.pathname === '/profiles'
    ) {
      navigate('/', { replace: true });
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    if (location.pathname === '/settings') {
      setSettingsModalState({
        open: true,
        tab: new URLSearchParams(location.search).get('tab') || 'general',
      });
    } else if (location.pathname === '/profiles') {
      setSettingsModalState({ open: true, tab: 'profiles' });
    }
  }, [location.pathname, location.search]);

  const navName = useMemo(
    () => location.pathname.split('/')[1] || 'dashboard',
    [location.pathname],
  );

  const activeSection = navigationSections[navName as NavigationKey];
  const [openKeysState, setOpenKeysState] = useState<{
    locationKey: string;
    keys: string[];
  }>({
    locationKey: location.key,
    keys: activeSection ? [activeSection] : [],
  });
  const openKeys = useMemo(
    () =>
      openKeysState.locationKey === location.key
        ? openKeysState.keys
        : activeSection
          ? [activeSection]
          : [],
    [openKeysState, location.key, activeSection],
  );

  const isWeb = window.web;
  const canManageAccess = !isWeb || canManageAccessPermission;
  const canUseHostTools = !isWeb || canUseHostToolsPermission;

  const menuItems = useMemo<MenuProps['items']>(
    () => [
      {
        key: 'dashboard',
        icon: <HomeOutlined style={{ fontSize: fontSizeLG }} />,
        label: 'Dashboard',
        className: 'gkit-collector-tutorial-step-0',
      },
      {
        key: 'profiles-and-bots',
        icon: <LuBot style={{ fontSize: fontSizeLG }} />,
        label: 'Botting',
        className: 'alt-tutorial-step-0',
        children: [
          {
            key: 'alts',
            icon: <TeamOutlined style={{ fontSize: fontSizeLG }} />,
            label: 'Accounts',
            className: 'alt-tutorial-step-1',
            disabled: isWeb && !canUseAccounts,
          },
          {
            key: 'bot',
            icon: <RiRobot2Line style={{ fontSize: fontSizeLG }} />,
            label: 'Bot',
            disabled: isWeb && !canUseActiveBots,
          },
          {
            key: 'plugins',
            icon: <MdOutlineExtension style={{ fontSize: fontSizeLG }} />,
            label: 'Plugins',
            disabled: isWeb && !canUseScripts && !canUsePlugins,
          },
          {
            key: 'triggers',
            icon: <ThunderboltOutlined style={{ fontSize: fontSizeLG }} />,
            label: 'Triggers',
            disabled: isWeb && !canUseScripts,
          },
        ],
      },
      {
        key: 'minecraft',
        icon: <IoCubeOutline style={{ fontSize: fontSizeLG }} />,
        label: 'Minecraft',
        children: [
          {
            key: 'launcher',
            icon: <LuGamepad2 style={{ fontSize: fontSizeLG }} />,
            label: 'Launcher',
            disabled: isWeb && !canUseHostTools,
          },
          {
            key: 'mc-server',
            icon: <TbBrandMinecraft style={{ fontSize: fontSizeLG }} />,
            label: 'MC Server',
            disabled: isWeb && !canUseHostTools,
          },
          {
            key: 'discord',
            icon: <DiscordOutlined style={{ fontSize: fontSizeLG }} />,
            label: 'Discord',
          },
        ],
      },

      {
        key: 'developer-tools',
        icon: <CloudServerOutlined style={{ fontSize: fontSizeLG }} />,
        label: 'Advanced',
        children: [
          {
            key: 'mcp',
            icon: <VscMcp style={{ fontSize: fontSizeLG }} />,
            label: 'MCP',
            disabled: isWeb && !canManageAccess,
          },
          {
            key: 'jnbotserver',
            icon: <CloudOutlined style={{ fontSize: fontSizeLG }} />,
            label: 'Remote',
            disabled: isWeb && !canManageAccess,
          },
          {
            key: 'jnbotproxy',
            icon: <GlobalOutlined style={{ fontSize: fontSizeLG }} />,
            label: 'Proxy',
          },
        ],
      },
      {
        key: 'marketplace',
        icon: <ShopOutlined style={{ fontSize: fontSizeLG }} />,
        label: 'Marketplace',
        disabled: isWeb && !canUsePlugins,
      },
      {
        key: 'settings',
        icon: <SettingOutlined style={{ fontSize: fontSizeLG }} />,
        label: 'Settings',
      },
    ],
    [
      fontSizeLG,
      isWeb,
      canManageAccess,
      canUseHostTools,
      canUseAccounts,
      canUseActiveBots,
      canUsePlugins,
      canUseScripts,
    ],
  );

  const handleMenuClick = useCallback<NonNullable<MenuProps['onClick']>>(
    ({ key }) => {
      if (key === 'settings') {
        openSettings();
        return;
      }
      const path = navigationPaths[key as NavigationKey];
      if (path) navigate(path);
    },
    [navigate, openSettings],
  );

  const handleOpenChange = useCallback<NonNullable<MenuProps['onOpenChange']>>(
    (nextOpenKeys) => {
      const latestOpenKey = nextOpenKeys.find((key) => !openKeys.includes(key));
      setOpenKeysState({
        locationKey: location.key,
        keys: latestOpenKey ? [latestOpenKey] : [],
      });
    },
    [location.key, openKeys],
  );

  const headerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = contentRef.current;
    const header = headerRef.current;
    if (!root || !header) return;

    const scrolledElements = new Set<HTMLElement>();
    let animationFrame: number | null = null;

    const updateHeader = () => {
      animationFrame = null;
      for (const element of scrolledElements) {
        if (!root.contains(element) || element.scrollTop === 0) {
          scrolledElements.delete(element);
        }
      }
      header.classList.toggle('scrolled', scrolledElements.size > 0);
    };

    const scheduleUpdate = () => {
      if (animationFrame === null) {
        animationFrame = requestAnimationFrame(updateHeader);
      }
    };

    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.scrollTop > 0) scrolledElements.add(target);
      else scrolledElements.delete(target);
      scheduleUpdate();
    };

    if (root.scrollTop > 0) scrolledElements.add(root);
    scheduleUpdate();
    root.addEventListener('scroll', onScroll, true);
    return () => {
      root.removeEventListener('scroll', onScroll, true);
      if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    };
  }, [location.pathname]);

  return (
    <div
      style={{ height: '100vh', overflow: 'hidden', background: colorBgLayout }}
    >
      <Layout style={{ height: '100vh', background: 'transparent' }}>
        <Sider
          breakpoint="md"
          collapsible
          collapsed={isSidebarCollapsed}
          onCollapse={handleSidebarCollapse}
          width={siderWidth}
          collapsedWidth={collapsedSiderWidth}
          className="floating-panel"
          style={{
            background: colorBgContainer,
            border: `1px solid ${colorBorderSecondary}`,
            margin: `${marginSM}px 0 ${marginSM}px ${marginSM}px`,
            borderRadius: borderRadiusLG,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              paddingTop: marginSM + marginXS + (isMac ? sizeLG : 0),
            }}
          >
            <div
              className="no-drag"
              style={{
                flexShrink: 0,
                padding: isSidebarCollapsed
                  ? `0 ${(collapsedSiderWidth - 40) / 2}px ${marginSM}px`
                  : `0 ${marginSM}px ${marginSM}px`,
              }}
            >
              <ServerModeSelector
                collapsed={isSidebarCollapsed}
                onOpenSettings={openSettings}
              />
            </div>

            <ConfigProvider
              theme={{
                components: {
                  Menu: {
                    itemSelectedBg: colorPrimaryBg,
                    itemSelectedColor: colorPrimaryText,
                    darkItemSelectedBg: colorPrimaryBg,
                    darkItemSelectedColor: colorText,
                  },
                },
              }}
            >
              <Menu
                theme={menuTheme}
                mode="inline"
                style={{
                  background: 'transparent',
                  flex: 1,
                  minHeight: 0,
                }}
                selectedKeys={[settingsModalState.open ? 'settings' : navName]}
                openKeys={openKeys}
                onOpenChange={handleOpenChange}
                onClick={handleMenuClick}
                items={menuItems}
              />
            </ConfigProvider>
          </div>
        </Sider>
        <Layout>
          <Header
            ref={headerRef}
            className={`drag-region floating-header ${
              isWin ? 'windows-controls-space' : ''
            } app-header`}
            style={{
              padding: '8px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              width: '100%',
              alignItems: 'center',
              marginRight: '2rem',
              position: 'absolute',
              zIndex: 999,
              height: headerHeight,
              paddingRight:
                (isSidebarCollapsed ? collapsedSiderWidth : siderWidth) +
                marginSM * 2 +
                (isWin ? 136 : 0),
            }}
          >
            <PageBreadCrumbs />
            <div className="no-drag">
              <Nav />
            </div>
          </Header>
          <Content
            ref={contentRef}
            style={{
              padding: '24px 8px',
              height: '100vh',
              overflow: 'auto',
              paddingTop: headerHeight + sizeLG,
            }}
          >
            <div
              style={{
                maxWidth: '1500px',
                width: 'calc(100% - 1rem)',
                margin: '0 auto',
              }}
            >
              <AnnouncementBanner />
            </div>
            <div
              style={{
                boxShadow: showPanel ? '0 0 10px rgba(0, 0, 0, 0.08)' : 'none',
                borderRadius: borderRadiusLG,
              }}
            >
              <PanelGroup
                direction="horizontal"
                autoSaveId="sidebar-panel-split"
                // The side panel is position:fixed, so the resize handle only
                // spans the page content; match the panel height on short pages.
                style={showPanel ? { minHeight: 'calc(100vh - 5rem)' } : undefined}
              >
                <Panel
                  defaultSize={65}
                  minSize={30}
                  id="sidebar-main-content"
                  order={1}
                >
                  {children}
                </Panel>
                {showPanel && (
                  <>
                    <PanelResizeHandle style={{ width: '0.5rem' }} />
                    <Panel
                      defaultSize={expandedSizeRef.current}
                      onResize={(size) => {
                        if (size > 1) expandedSizeRef.current = size;
                      }}
                      minSize={0}
                      id="sidebar-side-panel"
                      order={2}
                    >
                      <PinnedSidePanel
                        active={panel.active}
                        onExited={handlePanelExited}
                        tab={panel.tab}
                        onTabChange={(tab) => setPanel({ ...panel, tab })}
                        onClose={() => setPanel({ ...panel, active: false })}
                        reduceMotion={reduceMotion}
                      />
                    </Panel>
                  </>
                )}
              </PanelGroup>
            </div>
            <Footer />
          </Content>
        </Layout>
      </Layout>
      {settingsModalState.open && (
        <Suspense fallback={null}>
          <SettingsModal
            open
            defaultTab={settingsModalState.tab}
            onClose={closeSettings}
          />
        </Suspense>
      )}
    </div>
  );
};

const Sidebar: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AnnouncementProvider>
    <SidebarContent>{children}</SidebarContent>
  </AnnouncementProvider>
);

export default Sidebar;
