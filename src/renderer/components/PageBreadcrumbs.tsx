import { Breadcrumb } from 'antd';
import { useMemo } from 'react';
import { NavigationKey } from './Sidebar';
import { useLocation } from 'react-router-dom';

const pageNames: Partial<Record<NavigationKey, string>> = {
  dashboard: 'Dashboard',
  alts: 'Accounts',
  bot: 'Bot',
  plugins: 'Plugins',
  launcher: 'Launcher',
  discord: 'Discord',
  'mc-server': 'Minecraft Server',
  jnbotserver: 'Remote Access',
  jnbotproxy: 'Proxy',
  mcp: 'MCP',
  settings: 'Settings',
};

const PageBreadCrumbs: React.FC = () => {

  const location = useLocation();
  const breadcrumbs = useMemo(() => {
    let pieces = location.pathname.split('/').slice(1)
    pieces = pieces.map(
      (p) =>
        pageNames[p as NavigationKey] ||
        p.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
    );
    return pieces.map((p) => ({ title: <span style={{ fontWeight: '600' }}>{p}</span> }));
  }, [location.pathname]);
  if(breadcrumbs.length === 0 ) return null;
  return (
      <Breadcrumb items={breadcrumbs} />
  );
};

export default PageBreadCrumbs;
