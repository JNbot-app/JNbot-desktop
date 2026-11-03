import { FC, useEffect, useMemo, useState } from 'react';
import { Button, Flex, Popconfirm, Typography } from 'antd';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import type { ProfileUiRunResponse } from 'main/src/functions/ProfileUiRunner';
import type { ProfileUiJson } from 'common/profileUiSchema';
import {
  deleteAlt,
  selectAlts,
  selectAppSettings,
  selectJNdata,
  useSettingsStore,
} from 'renderer/redux/settings';
import { ALT_EDITOR_TAB } from 'renderer/components/other/botSideBar/panelTabs';
import { usePanelContext } from '../SidePanelContextProvider';
import AccountProfileView from './AccountProfileView';
import {
  ACCOUNT_PROFILE_TAB,
  AccountProfilePanelData,
} from './accountProfileTab';
import { buildFallbackProfile } from './fallbackProfile';

const AccountProfilePanel: FC<{ data: AccountProfilePanelData }> = ({
  data,
}) => {
  const { setPanel } = usePanelContext();
  const alts = useSettingsStore(selectAlts);
  const settings = useSettingsStore(selectAppSettings);
  const jndata = useSettingsStore(selectJNdata);
  const server = settings.server || jndata?.serverList?.[0] || '';
  const alt = useMemo(
    () =>
      alts.find(
        (candidate) =>
          candidate.username.toLowerCase() === data.username.toLowerCase(),
      ),
    [alts, data.username],
  );
  const [profile, setProfile] = useState<{
    json: ProfileUiJson | null;
    loading: boolean;
  }>({ json: null, loading: true });

  useEffect(() => {
    let current = true;
    setProfile({ json: null, loading: true });

    window.ipcRenderer
      .invoke<ProfileUiRunResponse>('profile-ui-run', {
        server,
        username: data.username,
      })
      .then((response) => {
        if (!current) return;
        const json = response?.ok
          ? (response.json as ProfileUiJson)
          : buildFallbackProfile({
              username: data.username,
              server,
              alt,
            });
        setProfile({
          json,
          loading: false,
        });
      })
      .catch(() => {
        if (!current) return;
        setProfile({
          json: buildFallbackProfile({
            username: data.username,
            server,
            alt,
          }),
          loading: false,
        });
      });

    return () => {
      current = false;
    };
  }, [alt, data.username, server]);

  const showProfile = (username: string) => {
    setPanel({ active: true, tab: ACCOUNT_PROFILE_TAB, data: { username } });
  };

  const editAlt = () => {
    setPanel({
      active: true,
      tab: ALT_EDITOR_TAB,
      data: { originalUsername: data.username },
    });
  };

  const removeAlt = () => {
    deleteAlt(data.username);
    setPanel((panel) => ({ ...panel, active: false }));
  };

  return (
    <div>
      <Flex
        align="center"
        justify="space-between"
        gap={8}
        style={{ marginBottom: 12 }}
      >
        <Typography.Text strong ellipsis>
          {data.username}
        </Typography.Text>
        {alt && (
          <Flex gap={4}>
            <Button variant='filled' icon={<EditOutlined />} onClick={editAlt}>
              Edit
            </Button>
            <Popconfirm
              title={`Delete ${data.username}?`}
              description="This account will be removed from the profile."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={removeAlt}
            >
              <Button
                type="text"
                danger
                aria-label={`Delete ${data.username}`}
                icon={<DeleteOutlined />}
              />
            </Popconfirm>
          </Flex>
        )}
      </Flex>
      <AccountProfileView
        json={profile.json}
        loading={profile.loading}
        onSelectUser={showProfile}
      />
    </div>
  );
};

export default AccountProfilePanel;
