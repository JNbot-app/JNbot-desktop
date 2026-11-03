import { FC, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Select,
  Space,
  theme,
} from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import {
  useSettingsStore,
  selectAlts,
  selectAppSettings,
} from '../../../redux/settings';
import ProfileActionPicker from '../scripts/ProfileActionPicker';
import SectionHeader from '../SectionHeader';
import AccountProfileView from '../../other/botSideBar/accountProfile/AccountProfileView';
import type { ProfileScript } from '../../../../common/profileScripts';
import type { Alt } from '../../../../main/src/types';
import type { ProfileUiJson } from '../../../../common/profileUiSchema';


interface Props {
  value: ProfileScript | undefined;
  onChange: (next: ProfileScript | undefined) => void;
}

/**
 * Wizard step that binds a profile-UI plugin to the profile. The picker
 * (select / import / create) is reused via `ProfileActionPicker`; this
 * step adds the live-preview pane on top so the user can iterate on
 * their plugin without leaving the wizard.
 */
const StepProfileUi: FC<Props> = ({ value, onChange }) => {
  const { token } = theme.useToken();
  const alts = useSettingsStore(selectAlts) as Alt[];
  const server = useSettingsStore(selectAppSettings).server;

  // --------- preview ---------

  const [previewUsername, setPreviewUsername] = useState<string>(
    alts[0]?.username ?? 'notch',
  );
  const [preview, setPreview] = useState<{
    json: ProfileUiJson | null;
    error?: string;
    loading: boolean;
  }>({ json: null, loading: false });

  const runPreview = async () => {
    if (!value || !previewUsername) return;
    setPreview({ json: null, loading: true });
    try {
      const res: any = await window.ipcRenderer.invoke('profile-ui-preview', {
        script: value,
        server,
        username: previewUsername,
      });
      if (res?.ok) {
        setPreview({ json: res.json, loading: false });
      } else {
        setPreview({
          json: null,
          loading: false,
          error:
            res?.reason === 'no-action'
              ? 'Action could not be resolved'
              : res?.error ?? 'Preview failed',
        });
      }
    } catch (err: any) {
      console.error(err);
      setPreview({
        json: null,
        loading: false,
        error: err?.message ?? 'Failed',
      });
    }
  };

  // Auto-run preview when the selected action changes.
  useEffect(() => {
    if (!value || !previewUsername) return;
    runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.id, value?.source, value?.checksum, previewUsername]);

  const altOptions = useMemo(
    () => alts.map((a) => ({ value: a.username, label: a.username })),
    [alts],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <SectionHeader title="Player stats">
          A plugin that shows server stats when you open a player. Leave empty
          for the basic view.
        </SectionHeader>

        <ProfileActionPicker
          scriptType="profileUi"
          value={value}
          onChange={onChange}
          candidatesTitle="Your Profile-UI plugins"
          createModal={{
            title: 'Create profile-UI plugin',
            defaultName: 'My profile UI',
            defaultDescription: 'Renders the player profile drawer.',
            helpText:
              'Creates a JS plugin pre-filled with a working default. Use Edit code afterwards to customize it.',
          }}
        />
      </div>

      <Card
        size="small"
        title={
          <Space>
            <EyeOutlined /> Preview
            {altOptions.length > 0 && (
              <Select
                size="small"
                value={previewUsername}
                onChange={setPreviewUsername}
                options={altOptions}
                style={{ minWidth: 160 }}
                disabled={!value}
              />
            )}
          </Space>
        }
        extra={
          <Button
            size="small"
            onClick={runPreview}
            loading={preview.loading}
            disabled={!value}
          >
            Refresh
          </Button>
        }
        styles={{ body: { background: token.colorBgLayout } }}
      >
        {!value ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Select an action to preview"
          />
        ) : preview.error ? (
          <Alert
            type="error"
            showIcon
            title="Preview failed"
            description={preview.error}
          />
        ) : (
          <AccountProfileView
            json={preview.json}
            loading={preview.loading}
            error={preview.error}
          />
        )}
      </Card>
    </div>
  );
};

export default StepProfileUi;
