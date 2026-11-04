import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Tabs, Typography } from 'antd';
import type { TabsProps } from 'antd';
import { MdDns, MdStorage } from 'react-icons/md';
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

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  defaultTab?: string;
}

const Section: React.FC<{
  title: string;
  spaced?: boolean;
  children: React.ReactNode;
}> = ({ title, spaced, children }) => (
  <>
    <Typography.Title
      level={4}
      className={`settings-section-title${spaced ? ' settings-section-title--spaced' : ''}`}
    >
      {title}
    </Typography.Title>
    {children}
  </>
);

const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  defaultTab,
}) => {
  const { setTheme, setLanguage } = useApp();
  const location = useLocation();
  const appSettings = useSettingsStore(selectAppSettings);
  const activeServerMeta = useSettingsStore(selectActiveServerMeta);
  const canChangeGlobal = useSettingsStore(selectCanChangeGlobalSettings);
  const canChangeGlobalSettings = !window.web || canChangeGlobal;
  const [activeTab, setActiveTab] = useState(() => {
    if (defaultTab) return defaultTab;
    if (
      location.pathname === '/profiles' ||
      location.search.includes('tab=profiles')
    ) {
      return 'profiles';
    }
    return window.web ? 'bot' : 'general';
  });

  useEffect(() => {
    if (open) {
      if (defaultTab) {
        setActiveTab(defaultTab);
      } else if (
        location.pathname === '/profiles' ||
        location.search.includes('tab=profiles')
      ) {
        setActiveTab('profiles');
      } else if (location.search.includes('tab=')) {
        const params = new URLSearchParams(location.search);
        const tab = params.get('tab');
        if (tab) setActiveTab(tab);
      }
    }
  }, [open, defaultTab, location.pathname, location.search]);

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

  const changeSetting = ({ key, value }: { key: string; value: any }) => {
    if (key === 'theme') setTheme(value);
    else if (key === 'locale') setLanguage(value);
    else if (key === 'server') return switchServer(value);

    updateAppSetting(key, value);
  };

  const items: TabsProps['items'] = useMemo(() => {
    const schemaTabs: TabsProps['items'] = settingsSchema.map((tab) => ({
      key: tab.key,
      icon: <tab.icon aria-hidden style={{ fontSize: '1.1em' }} />,
      label: tab.name,
      children: (
        <Section title={tab.name}>
          <div className="settings-list">
            {tab.settings.map((setting: SettingDef) => (
              <div className="settings-list-row" key={setting.key}>
                <SettingListItem
                  changeSetting={changeSetting}
                  value={appSettings[setting.key]}
                  setting={setting}
                  profileLabel={profileName}
                />
              </div>
            ))}
          </div>
        </Section>
      ),
    }));

    if (window.web) return schemaTabs;

    const profilesTab = {
      key: 'profiles',
      icon: <MdDns aria-hidden style={{ fontSize: '1.1em' }} />,
      label: 'Profiles',
      children: <ProfilesTab onNavigate={onClose} />,
    };

    const storageTab = {
      key: 'storage',
      icon: <MdStorage aria-hidden style={{ fontSize: '1.1em' }} />,
      label: 'Storage',
      children: (
        <Section title="Storage" spaced>
          <BackupTab />
        </Section>
      ),
    };

    const copy = [...schemaTabs];
    const generalIndex = schemaTabs.findIndex((t) => t?.key === 'general');
    if (generalIndex !== -1) {
      copy.splice(generalIndex + 1, 0, profilesTab);
    } else {
      copy.unshift(profilesTab);
    }

    copy.push(storageTab);
    return copy;
  }, [settingsSchema, appSettings, profileName, onClose]);

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
      <Tabs
        className="settings-tabs"
        tabPlacement="start"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={items}
      />
    </Modal>
  );
};

export default SettingsModal;
