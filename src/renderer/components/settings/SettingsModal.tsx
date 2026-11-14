import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Empty, Grid, Input, Menu, Modal, Select, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { MdDns, MdSearch, MdStorage } from 'react-icons/md';
import { useLocation } from 'react-router-dom';
import {
  selectActiveServerMeta,
  selectAppSettings,
  selectCanChangeGlobalSettings,
  switchServer,
  updateAppSetting,
  useSettingsStore,
} from '../../redux/settings';
import useApp from '../../hooks/useApp';
import SettingListItem from './SettingListItem';
import ProfilesTab from './ProfilesTab';
import BackupTab from './backup/BackupTab';
import { getSettingsSchema, type SettingDef } from './settingsSchema';

/** Old tab keys that deep links (notifications, URLs) may still use. */
const TAB_ALIASES: Record<string, string> = { sound: 'notifications' };

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  defaultTab?: string;
}

interface Page {
  key: string;
  name: string;
  group: string;
  icon: React.ElementType;
}

const SettingRows: React.FC<{
  settings: SettingDef[];
  values: Record<string, any>;
  profileLabel: string;
  changeSetting: (arg: { key: string; value: any }) => void;
}> = ({ settings, values, profileLabel, changeSetting }) => (
  <div className="settings-list">
    {settings.map((setting) => (
      <div className="settings-list-row" key={setting.key}>
        <SettingListItem
          changeSetting={changeSetting}
          value={values[setting.key]}
          setting={setting}
          profileLabel={profileLabel}
        />
      </div>
    ))}
  </div>
);

const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  defaultTab,
}) => {
  const { setTheme, setLanguage } = useApp();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const wide = screens.md !== false;
  const appSettings = useSettingsStore(selectAppSettings);
  const activeServerMeta = useSettingsStore(selectActiveServerMeta);
  const canChangeGlobal = useSettingsStore(selectCanChangeGlobalSettings);
  const canChangeGlobalSettings = !window.web || canChangeGlobal;
  const [query, setQuery] = useState('');

  const requestedTab = useMemo(() => {
    const tab =
      defaultTab ??
      (location.pathname === '/profiles' ? 'profiles' : undefined) ??
      new URLSearchParams(location.search).get('tab') ??
      undefined;
    return tab ? (TAB_ALIASES[tab] ?? tab) : undefined;
  }, [defaultTab, location.pathname, location.search]);
  const [activeTab, setActiveTab] = useState(requestedTab ?? 'general');

  useEffect(() => {
    if (open && requestedTab) setActiveTab(requestedTab);
    if (!open) setQuery('');
  }, [open, requestedTab]);

  const settingsSchema = useMemo(
    () =>
      getSettingsSchema()
        .map((tab) => ({
          ...tab,
          settings: window.web
            ? tab.settings.filter(
                (setting) => setting.profileSpecific || canChangeGlobalSettings,
              )
            : tab.settings,
        }))
        .filter((tab) => tab.settings.length > 0),
    [canChangeGlobalSettings],
  );
  const profileName =
    activeServerMeta?.name ?? activeServerMeta?.id ?? 'this profile';

  const changeSetting = useCallback(
    ({ key, value }: { key: string; value: any }) => {
      if (key === 'theme') setTheme(value);
      else if (key === 'locale') setLanguage(value);
      else if (key === 'server') return switchServer(value);

      updateAppSetting(key, value);
    },
    [setTheme, setLanguage],
  );

  // Sidebar pages in display order; Profiles/Storage only exist on desktop.
  const pages: Page[] = useMemo(() => {
    const list: Page[] = settingsSchema.map((t) => ({
      key: t.key,
      name: t.name,
      group: t.group,
      icon: t.icon,
    }));
    if (!window.web) {
      list.push(
        { key: 'profiles', name: 'Profiles', group: 'Manage', icon: MdDns },
        { key: 'storage', name: 'Storage & backup', group: 'Manage', icon: MdStorage },
      );
    }
    return list;
  }, [settingsSchema]);

  const page = pages.find((p) => p.key === activeTab) ?? pages[0];

  const menuItems: MenuProps['items'] = useMemo(() => {
    const groups: string[] = [];
    pages.forEach((p) => !groups.includes(p.group) && groups.push(p.group));
    return groups.map((group) => ({
      type: 'group' as const,
      key: group,
      label: group,
      children: pages
        .filter((p) => p.group === group)
        .map((p) => ({
          key: p.key,
          label: p.name,
          icon: <p.icon aria-hidden />,
        })),
    }));
  }, [pages]);

  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!needle) return [];
    return settingsSchema
      .map((tab) => ({
        tab,
        settings: tab.settings.filter((s) =>
          `${s.name} ${s.description ?? ''} ${s.section ?? ''} ${tab.name}`
            .toLowerCase()
            .includes(needle),
        ),
      }))
      .filter((m) => m.settings.length > 0);
  }, [needle, settingsSchema]);

  const rows = (settings: SettingDef[]) => (
    <SettingRows
      settings={settings}
      values={appSettings}
      profileLabel={profileName}
      changeSetting={changeSetting}
    />
  );

  const renderContent = () => {
    if (needle) {
      if (matches.length === 0) {
        return <Empty description={`No settings match “${query}”`} />;
      }
      return matches.map(({ tab, settings }) => (
        <Card key={tab.key} size="small" className="settings-card" title={`${tab.group} › ${tab.name}`}>
          {rows(settings)}
        </Card>
      ));
    }
    if (page?.key === 'profiles') return <ProfilesTab onNavigate={onClose} />;
    if (page?.key === 'storage') return <BackupTab />;

    const tab = settingsSchema.find((t) => t.key === page?.key);
    if (!tab) return null;
    const sections = tab.sections.filter((name) =>
      tab.settings.some((s) => s.section === name),
    );
    return sections.map((name) => (
      <Card
        key={name}
        size="small"
        className="settings-card"
        // A single section needs no sub-heading; the page title already says it.
        title={sections.length > 1 ? name : undefined}
      >
        {rows(tab.settings.filter((s) => s.section === name))}
      </Card>
    ));
  };

  const search = (
    <Input
      allowClear
      prefix={<MdSearch aria-hidden />}
      placeholder="Search settings"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
    />
  );

  return (
    <Modal
      className="settings-modal"
      open={open}
      onCancel={onClose}
      width={1040}
      centered
      keyboard
      maskClosable
      destroyOnHidden={false}
      footer={null}
      styles={{ container: { padding: 0 } }}
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {search}
          {wide ? (
            <Menu
              mode="inline"
              selectedKeys={needle ? [] : [page?.key]}
              items={menuItems}
              onClick={({ key }) => {
                setQuery('');
                setActiveTab(key);
              }}
            />
          ) : (
            <Select
              value={page?.key}
              onChange={(key) => {
                setQuery('');
                setActiveTab(key);
              }}
              options={pages.map((p) => ({ value: p.key, label: p.name }))}
            />
          )}
        </nav>
        <main className="settings-content">
          {(needle || page?.key !== 'profiles') && (
            <Typography.Title level={4} className="settings-section-title">
              {needle ? 'Search results' : page?.name}
            </Typography.Title>
          )}
          {renderContent()}
        </main>
      </div>
    </Modal>
  );
};

export default SettingsModal;
